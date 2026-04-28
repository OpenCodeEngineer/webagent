CREATE TABLE "meta_agent_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meta_agent_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"openclaw_session_key" text NOT NULL,
	"last_active_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meta_agent_sessions_openclaw_session_key_unique" UNIQUE("openclaw_session_key")
);
--> statement-breakpoint
ALTER TABLE "meta_agent_messages" ADD CONSTRAINT "meta_agent_messages_session_id_meta_agent_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."meta_agent_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_agent_sessions" ADD CONSTRAINT "meta_agent_sessions_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "meta_agent_sessions_customer_idx" ON "meta_agent_sessions" USING btree ("customer_id");