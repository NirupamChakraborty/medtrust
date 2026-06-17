/*
  Warnings:

  - You are about to drop the column `isTampered` on the `Appointment` table. All the data in the column will be lost.
  - You are about to drop the column `prescriptionUrl` on the `Appointment` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Appointment" DROP COLUMN "isTampered",
DROP COLUMN "prescriptionUrl",
ADD COLUMN     "uploadedPrescriptionHash" TEXT,
ADD COLUMN     "uploadedPrescriptionUrl" TEXT;

-- AlterTable
ALTER TABLE "User" ALTER COLUMN "verificationStatus" DROP NOT NULL;
