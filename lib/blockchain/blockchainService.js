import { ethers } from "ethers";
import { DEPLOYED_ADDRESSES } from "./addresses.js";


// ── Provider ──────────────────────────────────────────────────────────────────
function getProvider() {
  return new ethers.JsonRpcProvider(process.env.QUORUM_RPC_URL, {
    chainId: Number(process.env.QUORUM_CHAIN_ID) || 1337,
    name:    "quorum",
  });
}

// ── Signers ───────────────────────────────────────────────────────────────────
function getAdminSigner() {
  return new ethers.Wallet(
    process.env.QUORUM_ADMIN_PRIVATE_KEY,
    getProvider()
  );
}

export function getUserSigner(decryptedPrivateKey) {
  return new ethers.Wallet(decryptedPrivateKey, getProvider());
}

// ── ABI fragments ─────────────────────────────────────────────────────────────
const PATIENT_REGISTRY_ABI = [
  "function registerPatient(string _name, uint _age) external",
  "function isPatient(address _user) external view returns (bool)",
  "function patientData(address) external view returns (uint id, address wallet, string name, uint age)",
];

const DOCTOR_REGISTRY_ABI = [
  "function registerDoctor(string _name, string _specialization) external",
  "function approveDoctor(address _doctor) external",
  "function isApprovedDoctor(address _doctor) external view returns (bool)",
  "function doctorData(address) external view returns (address doctorAddress, string name, string specialization, bool approved)",
];

const HEALTHCARE_RECORD_ABI = [
  "function addRecord(address _patient, string _disease, string _ipfsHash) external",
  "function grantAccess(uint _id, address _user) external",
  "function revokeAccess(uint _id, address _user) external",
  "function getRecord(uint _id) external view returns (tuple(uint id, address patient, address doctor, string disease, string ipfsHash, uint timestamp))",
  "function getMyRecords() external view returns (uint[])",
  "function access(uint, address) external view returns (bool)",
  "function recordCount() external view returns (uint)",
];

// ── Contract helpers ──────────────────────────────────────────────────────────
function patientRegistry(signerOrProvider) {
  return new ethers.Contract(
    DEPLOYED_ADDRESSES.PatientRegistry,
    PATIENT_REGISTRY_ABI,
    signerOrProvider
  );
}

function doctorRegistry(signerOrProvider) {
  return new ethers.Contract(
    DEPLOYED_ADDRESSES.DoctorRegistry,
    DOCTOR_REGISTRY_ABI,
    signerOrProvider
  );
}

function healthcareRecord(signerOrProvider) {
  return new ethers.Contract(
    DEPLOYED_ADDRESSES.HealthcareRecord,
    HEALTHCARE_RECORD_ABI,
    signerOrProvider
  );
}

// ── Patient actions ───────────────────────────────────────────────────────────
export async function registerPatientOnChain(decryptedPrivateKey, name, age) {
  const signer   = getUserSigner(decryptedPrivateKey);
  const contract = patientRegistry(signer);
  const tx       = await contract.registerPatient(name, age, { gasPrice: 0 });
  const receipt  = await tx.wait();
  return { txHash: receipt.hash, blockNumber: receipt.blockNumber };
}

export async function isPatient(walletAddress) {
  return patientRegistry(getProvider()).isPatient(walletAddress);
}

// ── Doctor actions ────────────────────────────────────────────────────────────
export async function registerDoctorOnChain(decryptedPrivateKey, name, specialization) {
  const signer   = getUserSigner(decryptedPrivateKey);
  const contract = doctorRegistry(signer);
  const tx       = await contract.registerDoctor(name, specialization, { gasPrice: 0 });
  const receipt  = await tx.wait();
  return { txHash: receipt.hash, blockNumber: receipt.blockNumber };
}

export async function approveDoctorOnChain(doctorWalletAddress) {
  const signer   = getAdminSigner();
  const contract = doctorRegistry(signer);
  const tx       = await contract.approveDoctor(doctorWalletAddress, { gasPrice: 0 });
  const receipt  = await tx.wait();
  return { txHash: receipt.hash, blockNumber: receipt.blockNumber };
}

export async function isApprovedDoctor(walletAddress) {
  return doctorRegistry(getProvider()).isApprovedDoctor(walletAddress);
}

// ── Record actions ────────────────────────────────────────────────────────────
export async function addRecordOnChain(
  decryptedPrivateKey,
  patientWalletAddress,
  disease,
  contentHash
) {
  const signer   = getUserSigner(decryptedPrivateKey);
  const contract = healthcareRecord(signer);
  const tx       = await contract.addRecord(
    patientWalletAddress,
    disease,
    contentHash,
    { gasPrice: 0 }
  );
  const receipt = await tx.wait();
  return { txHash: receipt.hash, blockNumber: receipt.blockNumber };
}

export async function grantRecordAccess(decryptedPrivateKey, recordId, doctorWalletAddress) {
  const signer   = getUserSigner(decryptedPrivateKey);
  const contract = healthcareRecord(signer);
  const tx       = await contract.grantAccess(recordId, doctorWalletAddress, { gasPrice: 0 });
  const receipt  = await tx.wait();
  return { txHash: receipt.hash, blockNumber: receipt.blockNumber };
}

export async function revokeRecordAccess(decryptedPrivateKey, recordId, doctorWalletAddress) {
  const signer   = getUserSigner(decryptedPrivateKey);
  const contract = healthcareRecord(signer);
  const tx       = await contract.revokeAccess(recordId, doctorWalletAddress, { gasPrice: 0 });
  const receipt  = await tx.wait();
  return { txHash: receipt.hash, blockNumber: receipt.blockNumber };
}

export async function hasAccess(recordId, walletAddress) {
  return healthcareRecord(getProvider()).access(recordId, walletAddress);
}

export async function getRecordFromChain(decryptedPrivateKey, recordId) {
  const signer   = getUserSigner(decryptedPrivateKey);
  const contract = healthcareRecord(signer);
  return contract.getRecord(recordId);
}

export async function getMyRecords(decryptedPrivateKey) {
  const signer   = getUserSigner(decryptedPrivateKey);
  const contract = healthcareRecord(signer);
  return contract.getMyRecords();
}

// ── Integrity verification ────────────────────────────────────────────────────
export async function verifyDocumentIntegrity(cloudinaryUrl, onChainHash) {
  const response = await fetch(cloudinaryUrl, {
    headers: { "Cache-Control": "no-cache, no-store" },
  });
  if (!response.ok) throw new Error("Failed to fetch document from Cloudinary");

  const arrayBuffer    = await response.arrayBuffer();
  // const hashBuffer     = await crypto.subtle.digest("SHA-256", arrayBuffer);
  // const hashArray      = Array.from(new Uint8Array(hashBuffer));
  // const recomputedHash = "0x" + hashArray
  //   .map((b) => b.toString(16).padStart(2, "0"))
  //   .join("");
  const recomputedHash = ethers.keccak256(new Uint8Array(arrayBuffer));

  return {
    match:           recomputedHash === onChainHash,
    recomputedHash,
    onChainHash,
  };
}