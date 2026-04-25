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
  adapter: {
    // Wrap DrizzleAdapter in a lazy getter so the DB connection is only
    // opened at runtime, not during Next.js static build/collect phase.
    ...(() => {
      let _adapter: ReturnType<typeof DrizzleAdapter> | undefined;
      const get = () => {
        if (!_adapter) _adapter = DrizzleAdapter(getDb() as any);
        return _adapter;
      };
      // Return an object whose methods lazily initialize the real adapter.
      return new Proxy({} as ReturnType<typeof DrizzleAdapter>, {
        get(_target, prop) {
          const real = get();
          const val = (real as any)[prop];
          return typeof val === "function" ? val.bind(real) : val;
        },
      });
    })(),
  },
  secret: process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET,
  pages: {
    signIn: "/login",
    error: "/login",
  },
  session: {
    strategy: "jwt",
  },
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),
    GitHub({
      clientId: process.env.GITHUB_CLIENT_ID,
      clientSecret: process.env.GITHUB_CLIENT_SECRET,
    }),
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
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.id) {
        session.user.id = token.id as string;
      }
      return session;
    },
  },
});
