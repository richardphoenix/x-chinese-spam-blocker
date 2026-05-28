ALTER TABLE "submissions" DROP CONSTRAINT "submissions_user_id_unique";--> statement-breakpoint
ALTER TABLE "submissions" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "submissions" ALTER COLUMN "screen_name" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_screen_name_unique" UNIQUE("screen_name");