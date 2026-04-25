import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Email from "next-auth/providers/email";
import GitHub from "next-auth/providers/github";
import Google from "next-auth/providers/google";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { getDb } from "./db";
import { users, accounts } from "./auth-schema";

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: (() => {
    // Lazy-init DrizzleAdapter so the DB connection is only opened at
    // runtime, not during Next.js static build/collect phase.
    // We use a plain object with explicit method delegation instead of
    // Proxy to avoid breaking NextAuth's internal adapter type checks.
    let _adapter: ReturnType<typeof DrizzleAdapter> | undefined;
    const get = () => {
      if (!_adapter) _adapter = DrizzleAdapter(getDb() as any);
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
      },
      async authorize(credentials) {
        const email = credentials?.email;
        const password = credentials?.password;
        if (typeof email !== "string" || typeof password !== "string") {
          return null;
        }

        const existingUsers = await getDb()
          .select()
          .from(users)
          .where(eq(users.email, email))
          .limit(1);

        const existingUser = existingUsers[0];

        if (existingUser) {
          const credentialAccounts = await getDb()
            .select()
            .from(accounts)
            .where(eq(accounts.userId, existingUser.id))
            .limit(10);

          const credAccount = credentialAccounts.find(
            (a) => a.provider === "credentials"
          );

          if (!credAccount?.access_token) {
            return null;
          }

          const isValid = await bcrypt.compare(password, credAccount.access_token);
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

        const hashedPassword = await bcrypt.hash(password, 12);
        const userId = crypto.randomUUID();

        await getDb().insert(users).values({
          id: userId,
          email,
          name: email.split("@")[0],
        });

        await getDb().insert(accounts).values({
          userId,
          type: "credentials",
          provider: "credentials",
          providerAccountId: email,
          access_token: hashedPassword,
        });

        return {
          id: userId,
          email,
          name: email.split("@")[0],
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
  },
});
