ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "paperclip_agent_id" text;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "invite_codes" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"createdBy" text,
	"email" text,
	"usedBy" text,
	"usedAt" timestamp,
	"expiresAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invite_codes" ADD CONSTRAINT "invite_codes_createdBy_users_id_fk" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "invite_codes" ADD CONSTRAINT "invite_codes_usedBy_users_id_fk" FOREIGN KEY ("usedBy") REFERENCES "users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "invite_codes_code_unique" ON "invite_codes" USING btree ("code");
