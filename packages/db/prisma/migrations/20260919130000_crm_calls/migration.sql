-- AlterEnum
ALTER TYPE "ChangeSource" ADD VALUE 'PHONE';

-- AlterTable
ALTER TABLE "unit_activity" ADD COLUMN     "call_direction" TEXT,
ADD COLUMN     "duration_sec" INTEGER,
ADD COLUMN     "external_ref" TEXT,
ADD COLUMN     "recording_url" TEXT;

