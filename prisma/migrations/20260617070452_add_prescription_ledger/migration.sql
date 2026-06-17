/*
  Warnings:

  - You are about to drop the column `sha256Hash` on the `Prescription` table. All the data in the column will be lost.
  - Added the required column `keccak256Hash` to the `Prescription` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Prescription" DROP COLUMN "sha256Hash",
ADD COLUMN     "keccak256Hash" TEXT NOT NULL;
