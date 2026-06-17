/*
  Warnings:

  - Made the column `verificationStatus` on table `User` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN     "isTampered" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "prescriptionHash" TEXT,
ADD COLUMN     "prescriptionUrl" TEXT;

-- AlterTable
ALTER TABLE "User" ALTER COLUMN "verificationStatus" SET NOT NULL;
