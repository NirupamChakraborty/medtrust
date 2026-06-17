-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN     "blockchainRecordId" TEXT,
ADD COLUMN     "blockchainTxHash" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "encryptedWalletKey" TEXT,
ADD COLUMN     "walletAddress" TEXT;
