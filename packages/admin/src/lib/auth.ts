import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Email from "next-auth/providers/email";
import GitHub from "next-auth/providers/github";
import Google from "next-auth/providers/google";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { eq, and, isNull } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { getDb } from "./db";
import { users, accounts, sessions, verificationTokens, inviteCodes } from "./auth-schema";

const normalizeEmail = (email: string): string => email.trim().toLowerCase();

const getInvitedEmails = (): Set<string> =>
  new Set(
    (process.env.AUTH_INVITE_EMAILS ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );

const isInvitedEmail = (email: string): boolean => getInvitedEmails().has(normalizeEmail(email));

async function validateAndConsumeInviteCode(
  code: string,
  email: string,
  userId: string,
): Promise<boolean> {
  const db = getDb();
  const normalizedEmail = normalizeEmail(email);
  const rows = await db
    .select()
    .from(inviteCodes)
    .where(and(eq(inviteCodes.code, code), isNull(inviteCodes.usedBy)))
    .limit(1);
  const invite = rows[0];
  if (!invite) return false;
  if (invite.expiresAt && invite.expiresAt.getTime() < Date.now()) return false;
  if (invite.email && normalizeEmail(invite.email) !== normalizedEmail) return false;

  await db
    .update(inviteCodes)
    .set({ usedBy: userId, usedAt: new Date() })
    .where(eq(inviteCodes.id, invite.id));

  return true;
}

async function findUserByEmailVariants(email: string) {
  const rawEmail = email.trim();
  const normalizedEmail = normalizeEmail(rawEmail);
  const candidates = rawEmail === normalizedEmail ? [rawEmail] : [rawEmail, normalizedEmail];

  for (const candidate of candidates) {
    const existingUsers = await getDb()
      .select()
      .from(users)
      .where(eq(users.email, candidate))
      .limit(1);
    const existingUser = existingUsers[0];
    if (existingUser) {
      return existingUser;
    }
  }

  return null;
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: (() => {
    // Lazy-init DrizzleAdapter so the DB connection is only opened at
    // runtime, not during Next.js static build/collect phase.
    let _adapter: ReturnType<typeof DrizzleAdapter> | undefined;
    const get = () => {
      if (!_adapter)
        _adapter = DrizzleAdapter(getDb() as any, {
          usersTable: users as any,
          accountsTable: accounts as any,
          sessionsTable: sessions as any,
          verificationTokensTable: verificationTokens as any,
        });
      return _adapter;
    };
    return {
      createUser: (...args: any[]) => (get() as any).createUser(...args),
      getUser: (...args: any[]) => (get() as any).getUser(...args),
      getUserByEmail: (...args: any[]) => (get() as any).getUserByEmail(...args),
      getUserByAccount: (...args: any[]) => (get() as any).getUserByAccount(...args),
      updateUser: (...args: any[]) => (get() as any).updateUser(...args),
      deleteUser: (...args: any[]) => (get() as any).deleteUser(...args),
      linkAccount: (...args: any[]) => (get() as any).linkAccount(...args),
      unlinkAccount: (...args: any[]) => (get() as any).unlinkAccount(...args),
      createSession: (...args: any[]) => (get() as any).createSession(...args),
      getSessionAndUser: (...args: any[]) => (get() as any).getSessionAndUser(...args),
      updateSession: (...args: any[]) => (get() as any).updateSession(...args),
      deleteSession: (...args: any[]) => (get() as any).deleteSession(...args),
      createVerificationToken: (...args: any[]) => (get() as any).createVerificationToken(...args),
      useVerificationToken: (...args: any[]) => (get() as any).useVerificationToken(...args),
    } as ReturnType<typeof DrizzleAdapter>;
  })(),
  secret: process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET,
  pages: {
    signIn: "/login",
    error: "/login",
  },
  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60,
  },
  providers: [
    ...(process.env.GOOGLE_CLIENT_ID
      ? [
          Google({
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
          }),
        ]
      : []),
    ...(process.env.GITHUB_CLIENT_ID
      ? [
          GitHub({
            clientId: process.env.GITHUB_CLIENT_ID,
            clientSecret: process.env.GITHUB_CLIENT_SECRET ?? "",
          }),
        ]
      : []),
    ...(process.env.EMAIL_SERVER
      ? [
          Email({
            server: process.env.EMAIL_SERVER,
            from: process.env.EMAIL_FROM || "Lamoom <noreply@lamoom.com>",
          }),
        ]
      : []),
    Credentials({
      name: "Email",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
        inviteCode: { label: "Invite Code", type: "text" },
      },
      async authorize(credentials) {
        const email = credentials?.email;
        const password = credentials?.password;
        const inviteCode = credentials?.inviteCode;
        if (typeof email !== "string" || typeof password !== "string") {
          return null;
        }
        const rawEmail = email.trim();
        const normalizedEmail = normalizeEmail(rawEmail);
        const existingUser = await findUserByEmailVariants(rawEmail);

        if (existingUser) {
          if (!existingUser.hashedPassword) {
            return null;
          }

          const isValid = await bcrypt.compare(password, existingUser.hashedPassword);
          if (!isValid) {
            return null;
          }

          return {
            id: existingUser.id,
            email: existingUser.email,
            name: existingUser.name,
            image: existingUser.image,
          };
        }

        // New user registration: require allowlist OR valid invite code
        const onAllowlist = isInvitedEmail(normalizedEmail);
        if (!onAllowlist && typeof inviteCode !== "string") {
          return null;
        }

        const hashedPassword = await bcrypt.hash(password, 12);
        const userId = crypto.randomUUID();

        // If not on allowlist, validate and consume the invite code before creating user
        if (!onAllowlist) {
          const codeValid = await validateAndConsumeInviteCode(
            inviteCode as string,
            normalizedEmail,
            userId,
          );
          if (!codeValid) {
            return null;
          }
        }

        await getDb().insert(users).values({
          id: userId,
          email: normalizedEmail,
          name: normalizedEmail.split("@")[0],
          hashedPassword,
        });

        await getDb().insert(accounts).values({
          userId,
          type: "credentials",
          provider: "credentials",
          providerAccountId: normalizedEmail,
        });

        return {
          id: userId,
          email: normalizedEmail,
          name: normalizedEmail.split("@")[0],
        };
      },
    }),
  ],
  callbacks: {
    authorized({ auth }) {
      return !!auth?.user;
    },
    async jwt({ token, user }) {
      if (user?.id) {
        token.id = user.id;
      }
      if (user?.email) {
        token.email = user.email;
      }
      const adminEmails = new Set(
        (process.env.ADMIN_EMAILS ?? "")
          .split(",")
          .map((email) => email.trim().toLowerCase())
          .filter(Boolean),
      );
      const email = (token.email ?? "").trim().toLowerCase();
      token.isAdmin = email ? adminEmails.has(email) : false;
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        if (token.id) {
          session.user.id = token.id as string;
        }
        session.user.isAdmin = Boolean(token.isAdmin);
      }
      return session;
    },
    async signIn({ user }) {
      const rawEmail = typeof user?.email === "string" ? user.email.trim() : "";
      if (!rawEmail) {
        return false;
      }

      const existingUser = await findUserByEmailVariants(rawEmail);
      if (existingUser) {
        return true;
      }

      return isInvitedEmail(rawEmail);
    },
  },
});
