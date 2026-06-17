

"use client";

import { generateVideoToken } from "@/actions/appointments";
import {
  addAppointmentNotes,
  cancelAppointment,
  markAppointmentCompleted,
} from "@/actions/doctor";
import {
  checkPrescriptionIntegrity,
  generatePrescriptionPDF,
  grantDoctorAccessToPrescription,
  uploadPrescriptionToDoctor,
  verifyPrescriptionIntegrity
} from "@/actions/prescription";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import useFetch from "@/hooks/use-fetch";
import { format } from "date-fns";
import {
  AlertTriangle,
  Calendar,
  CheckCircle,
  Clock,
  Download,
  Edit,
  FileText,
  Loader2,
  ShieldCheck,
  ShieldX,
  Stethoscope,
  Upload,
  User,
  Video,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";

export function AppointmentCard({
  appointment,
  userRole,
  refetchAppointments,
  allPatientAppointments = [],
}) {
  const [open, setOpen] = useState(false);
  const [action, setAction] = useState(null);
  const [notes, setNotes] = useState(appointment.notes || "");
  const [verifyResult, setVerifyResult] = useState(null);
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [grantLoading, setGrantLoading] = useState(false);
  const [prescriptionDownloadedThisSession, setPrescriptionDownloadedThisSession] = useState(false);
  const [selectedSourceId, setSelectedSourceId] = useState("");
  const router = useRouter();

  // ── Integrity auto-check (patient side) ──────────────────────────
  // Runs once when the dialog opens. Catches FILE_DELETED and TAMPERED
  // before the patient tries anything. Shows a permanent banner.
  const [integrityStatus, setIntegrityStatus] = useState(null);

  useEffect(() => {
    if (!open) { setIntegrityStatus(null); return; }
    if (userRole !== "PATIENT") return;
    if (!appointment.prescriptionUrl) return;

    checkPrescriptionIntegrity(appointment.id)
      .then((result) => setIntegrityStatus(result))
      .catch(() => {});
  }, [open]);

  // ── existing hooks ────────────────────────────────────────────
  const {
    loading: cancelLoading,
    fn: submitCancel,
    data: cancelData,
  } = useFetch(cancelAppointment);

  const {
    loading: notesLoading,
    fn: submitNotes,
    data: notesData,
  } = useFetch(addAppointmentNotes);

  const {
    loading: tokenLoading,
    fn: submitTokenRequest,
    data: tokenData,
  } = useFetch(generateVideoToken);

  const {
    loading: completeLoading,
    fn: submitMarkCompleted,
    data: completeData,
  } = useFetch(markAppointmentCompleted);

  // ── new hooks ─────────────────────────────────────────────────
  const {
    loading: pdfLoading,
    fn: fetchPDF,
    data: pdfData,
  } = useFetch(generatePrescriptionPDF);

  const {
    loading: uploadLoading,
    fn: submitUpload,
    data: uploadData,
    error: uploadError,
  } = useFetch(uploadPrescriptionToDoctor);

  // ── helpers ───────────────────────────────────────────────────
  const formatDateTime = (dateString) => {
    try {
      return format(new Date(dateString), "MMMM d, yyyy 'at' h:mm a");
    } catch (e) {
      return "Invalid date";
    }
  };

  const formatTime = (dateString) => {
    try {
      return format(new Date(dateString), "h:mm a");
    } catch (e) {
      return "Invalid time";
    }
  };

  const canMarkCompleted = () => {
    if (userRole !== "DOCTOR" || appointment.status !== "SCHEDULED") return false;
    const now = new Date();
    const appointmentEndTime = new Date(appointment.endTime);
    return now >= appointmentEndTime;
  };

  const isAppointmentActive = () => {
    const now = new Date();
    const appointmentTime = new Date(appointment.startTime);
    const appointmentEndTime = new Date(appointment.endTime);
    return (
      (appointmentTime.getTime() - now.getTime() <= 30 * 60 * 1000 &&
        now < appointmentTime) ||
      (now >= appointmentTime && now <= appointmentEndTime)
    );
  };

  // ── existing handlers ─────────────────────────────────────────
  const handleCancelAppointment = async () => {
    if (cancelLoading) return;
    if (window.confirm("Are you sure you want to cancel this appointment? This action cannot be undone.")) {
      const formData = new FormData();
      formData.append("appointmentId", appointment.id);
      await submitCancel(formData);
    }
  };

  const handleMarkCompleted = async () => {
    if (completeLoading) return;
    const now = new Date();
    const appointmentEndTime = new Date(appointment.endTime);
    if (now < appointmentEndTime) {
      alert("Cannot mark appointment as completed before the scheduled end time.");
      return;
    }
    if (window.confirm("Are you sure you want to mark this appointment as completed? This action cannot be undone.")) {
      const formData = new FormData();
      formData.append("appointmentId", appointment.id);
      await submitMarkCompleted(formData);
    }
  };

  const handleSaveNotes = async () => {
    if (notesLoading || userRole !== "DOCTOR") return;
    const formData = new FormData();
    formData.append("appointmentId", appointment.id);
    formData.append("notes", notes);
    await submitNotes(formData);
  };

  const handleJoinVideoCall = async () => {
    if (tokenLoading) return;
    setAction("video");
    const formData = new FormData();
    formData.append("appointmentId", appointment.id);
    await submitTokenRequest(formData);
  };

  // ── new handlers ──────────────────────────────────────────────
  const handleDownloadPrescription = async () => {
    await fetchPDF(appointment.id);
  };

  // Called when patient clicks the direct Cloudinary download link (prescription already exists).
  // Sets the session flag so the Grant Access button appears without a server round-trip.
  const handleDirectDownload = () => {
    setPrescriptionDownloadedThisSession(true);
    toast.success("Prescription downloaded! You can now grant blockchain access to your doctor.");
  };

  const handleUploadPrescription = async (sourceAppointmentId) => {
    const formData = new FormData();
    formData.append("appointmentId", appointment.id);
    // sourceAppointmentId is the appointment that has the prescription to share.
    // If not provided, defaults to the current appointment in the server action.
    if (sourceAppointmentId) {
      formData.append("sourceAppointmentId", sourceAppointmentId);
    }
    await submitUpload(formData);
  };

  const handleGrantAccess = async () => {
    setGrantLoading(true);
    try {
      const result = await grantDoctorAccessToPrescription(
        appointment.id,
        appointment.doctorId
      );
      if (result.success) {
        toast.success("Blockchain access granted to doctor!");
      }
    } catch (err) {
      toast.error(err.message);
    } finally {
      setGrantLoading(false);
    }
  };

  const handleVerify = async () => {
    setVerifyLoading(true);
    try {
      const result = await verifyPrescriptionIntegrity(appointment.id);
      setVerifyResult(result);
      if (result.tampered) {
        toast.error("⚠️ Prescription has been tampered with!");
      } else {
        toast.success("✅ Prescription verified — document is authentic");
      }
    } catch (err) {
      toast.error(err.message);
    } finally {
      setVerifyLoading(false);
    }
  };

  // ── existing effects ──────────────────────────────────────────
  useEffect(() => {
    if (cancelData?.success) {
      toast.success("Appointment cancelled successfully");
      setOpen(false);
      if (refetchAppointments) refetchAppointments();
      else router.refresh();
    }
  }, [cancelData, refetchAppointments, router]);

  useEffect(() => {
    if (completeData?.success) {
      toast.success("Appointment marked as completed");
      setOpen(false);
      if (refetchAppointments) refetchAppointments();
      else router.refresh();
    }
  }, [completeData, refetchAppointments, router]);

  useEffect(() => {
    if (notesData?.success) {
      toast.success("Notes saved successfully");
      setAction(null);
      if (refetchAppointments) refetchAppointments();
      else router.refresh();
    }
  }, [notesData, refetchAppointments, router]);

  useEffect(() => {
    if (tokenData?.success) {
      router.push(
        `/video-call?sessionId=${tokenData.videoSessionId}&token=${tokenData.token}&appointmentId=${appointment.id}`
      );
    } else if (tokenData?.error) {
      setAction(null);
    }
  }, [tokenData, appointment.id, router]);

  // ── new effects ───────────────────────────────────────────────
  useEffect(() => {
    if (pdfData?.success) {
      // Download directly from the Cloudinary URL saved at generation time.
      // This is the canonical file — same bytes that were hashed and anchored on-chain.
      const link = document.createElement("a");
      link.href     = pdfData.url;
      link.download = pdfData.fileName;
      link.target   = "_blank"; // fallback if download attr is blocked cross-origin
      link.click();
      toast.success("Prescription downloaded! You can now grant blockchain access to your doctor.");
      setPrescriptionDownloadedThisSession(true);
      if (refetchAppointments) refetchAppointments();
      else router.refresh();
    }
  }, [pdfData]);

  useEffect(() => {
    if (uploadData?.success) {
      toast.success("Prescription shared successfully! Now grant the doctor blockchain access.");
      if (refetchAppointments) refetchAppointments();
      else router.refresh();
    }
  }, [uploadData]);

  // ── other party ───────────────────────────────────────────────
  const otherParty = userRole === "DOCTOR" ? appointment.patient : appointment.doctor;
  const otherPartyLabel = userRole === "DOCTOR" ? "Patient" : "Doctor";
  const otherPartyIcon = userRole === "DOCTOR" ? <User /> : <Stethoscope />;

  return (
    <>
      {/* ── Card ─────────────────────────────────────────────── */}
      <Card className="border-emerald-900/20 hover:border-emerald-700/30 transition-all">
        <CardContent className="p-4">
          <div className="flex flex-col md:flex-row justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="bg-muted/20 rounded-full p-2 mt-1">{otherPartyIcon}</div>
              <div>
                <h3 className="font-medium text-white">
                  {userRole === "DOCTOR" ? otherParty.name : `Dr. ${otherParty.name}`}
                </h3>
                {userRole === "DOCTOR" && (
                  <p className="text-sm text-muted-foreground">{otherParty.email}</p>
                )}
                {userRole === "PATIENT" && (
                  <p className="text-sm text-muted-foreground">{otherParty.specialty}</p>
                )}
                <div className="flex items-center mt-2 text-sm text-muted-foreground">
                  <Calendar className="h-4 w-4 mr-1" />
                  <span>{formatDateTime(appointment.startTime)}</span>
                </div>
                <div className="flex items-center mt-1 text-sm text-muted-foreground">
                  <Clock className="h-4 w-4 mr-1" />
                  <span>
                    {formatTime(appointment.startTime)} - {formatTime(appointment.endTime)}
                  </span>
                </div>
              </div>
            </div>
            <div className="flex flex-col gap-2 self-end md:self-start">
              <Badge
                variant="outline"
                className={
                  appointment.status === "COMPLETED"
                    ? "bg-emerald-900/20 border-emerald-900/30 text-emerald-400"
                    : appointment.status === "CANCELLED"
                    ? "bg-red-900/20 border-red-900/30 text-red-400"
                    : "bg-amber-900/20 border-amber-900/30 text-amber-400"
                }
              >
                {appointment.status}
              </Badge>
              <div className="flex gap-2 mt-2 flex-wrap">
                {canMarkCompleted() && (
                  <Button
                    size="sm"
                    onClick={handleMarkCompleted}
                    disabled={completeLoading}
                    className="bg-emerald-600 hover:bg-emerald-700"
                  >
                    {completeLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <><CheckCircle className="h-4 w-4 mr-1" />Complete</>
                    )}
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  className="border-emerald-900/30"
                  onClick={() => setOpen(true)}
                >
                  View Details
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Dialog ───────────────────────────────────────────── */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold text-white">
              Appointment Details
            </DialogTitle>
            <DialogDescription>
              {appointment.status === "SCHEDULED"
                ? "Manage your upcoming appointment"
                : "View appointment information"}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">

            {/* ── Integrity status banner (patient only, auto-checked on open) ── */}
            {userRole === "PATIENT" &&
              integrityStatus &&
              integrityStatus.status !== "NO_PRESCRIPTION" &&
              integrityStatus.status !== "VERIFIED" && (
              <div className={`rounded-lg border p-4 space-y-2 ${
                integrityStatus.status === "FILE_DELETED" || integrityStatus.status === "TAMPERED"
                  ? "bg-red-950/40 border-red-700/50"
                  : "bg-amber-950/30 border-amber-700/40"
              }`}>
                <div className="flex items-center gap-2">
                  <AlertTriangle className={`h-5 w-5 shrink-0 ${
                    integrityStatus.status === "FILE_DELETED" || integrityStatus.status === "TAMPERED"
                      ? "text-red-400" : "text-amber-400"
                  }`} />
                  <p className={`text-sm font-semibold ${
                    integrityStatus.status === "FILE_DELETED" || integrityStatus.status === "TAMPERED"
                      ? "text-red-400" : "text-amber-400"
                  }`}>
                    {integrityStatus.status === "FILE_DELETED"    && "INTEGRITY VIOLATION: Prescription file has been deleted"}
                    {integrityStatus.status === "TAMPERED"        && "INTEGRITY VIOLATION: Prescription has been tampered with"}
                    {integrityStatus.status === "VERIFIED_OFFLINE"&& "Verified (blockchain offline — used cached hash)"}
                    {integrityStatus.status === "CHECK_FAILED"    && "Could not verify prescription integrity"}
                    {integrityStatus.status === "NO_HASH"         && "No hash available to verify prescription"}
                  </p>
                </div>

                {integrityStatus.status === "FILE_DELETED" && (
                  <p className="text-xs text-red-300">
                    The prescription PDF was removed from storage after it was generated.
                    This is a critical integrity violation. Contact support immediately.
                    The blockchain record still exists and proves tampering occurred.
                  </p>
                )}

                {integrityStatus.status === "TAMPERED" && (
                  <div className="space-y-2">
                    <p className="text-xs text-red-300">
                      The file in storage no longer matches the original blockchain record.
                      Someone modified the prescription after it was generated. Do not share this with any doctor.
                    </p>
                    <div className="space-y-1 font-mono text-xs break-all bg-black/30 rounded p-2">
                      <p>
                        <span className="text-red-400 font-bold">Current file hash:&nbsp;</span>
                        <span className="text-red-300">{integrityStatus.recomputedHash}</span>
                      </p>
                      <p>
                        <span className="text-emerald-400 font-bold">Original hash ({integrityStatus.hashSource === "blockchain" ? "Quorum blockchain" : "DB cache"}):&nbsp;</span>
                        <span className="text-emerald-300">{integrityStatus.canonicalHash}</span>
                      </p>
                    </div>
                  </div>
                )}

                {integrityStatus.status === "CHECK_FAILED" && (
                  <p className="text-xs text-amber-300">{integrityStatus.message}</p>
                )}
              </div>
            )}

            {/* Other Party */}
            <div className="space-y-2">
              <h4 className="text-sm font-medium text-muted-foreground">{otherPartyLabel}</h4>
              <div className="flex items-center">
                <div className="h-5 w-5 text-emerald-400 mr-2">{otherPartyIcon}</div>
                <div>
                  <p className="text-white font-medium">
                    {userRole === "DOCTOR" ? otherParty.name : `Dr. ${otherParty.name}`}
                  </p>
                  {userRole === "DOCTOR" && (
                    <p className="text-muted-foreground text-sm">{otherParty.email}</p>
                  )}
                  {userRole === "PATIENT" && (
                    <p className="text-muted-foreground text-sm">{otherParty.specialty}</p>
                  )}
                </div>
              </div>
            </div>

            {/* Scheduled Time */}
            <div className="space-y-2">
              <h4 className="text-sm font-medium text-muted-foreground">Scheduled Time</h4>
              <div className="flex flex-col gap-1">
                <div className="flex items-center">
                  <Calendar className="h-5 w-5 text-emerald-400 mr-2" />
                  <p className="text-white">{formatDateTime(appointment.startTime)}</p>
                </div>
                <div className="flex items-center">
                  <Clock className="h-5 w-5 text-emerald-400 mr-2" />
                  <p className="text-white">
                    {formatTime(appointment.startTime)} - {formatTime(appointment.endTime)}
                  </p>
                </div>
              </div>
            </div>

            {/* Status */}
            <div className="space-y-2">
              <h4 className="text-sm font-medium text-muted-foreground">Status</h4>
              <Badge
                variant="outline"
                className={
                  appointment.status === "COMPLETED"
                    ? "bg-emerald-900/20 border-emerald-900/30 text-emerald-400"
                    : appointment.status === "CANCELLED"
                    ? "bg-red-900/20 border-red-900/30 text-red-400"
                    : "bg-amber-900/20 border-amber-900/30 text-amber-400"
                }
              >
                {appointment.status}
              </Badge>
            </div>

            {/* Patient Description */}
            {appointment.patientDescription && (
              <div className="space-y-2">
                <h4 className="text-sm font-medium text-muted-foreground">
                  {userRole === "DOCTOR" ? "Patient Description" : "Your Description"}
                </h4>
                <div className="p-3 rounded-md bg-muted/20 border border-emerald-900/20">
                  <p className="text-white whitespace-pre-line">{appointment.patientDescription}</p>
                </div>
              </div>
            )}

            {/* Video Call */}
            {appointment.status === "SCHEDULED" && (
              <div className="space-y-2">
                <h4 className="text-sm font-medium text-muted-foreground">Video Consultation</h4>
                <Button
                  className="w-full bg-emerald-600 hover:bg-emerald-700"
                  disabled={!isAppointmentActive() || action === "video" || tokenLoading}
                  onClick={handleJoinVideoCall}
                >
                  {tokenLoading || action === "video" ? (
                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Preparing Video Call...</>
                  ) : (
                    <>
                      <Video className="h-4 w-4 mr-2" />
                      {isAppointmentActive()
                        ? "Join Video Call"
                        : "Video call will be available 30 minutes before appointment"}
                    </>
                  )}
                </Button>
              </div>
            )}

            {/* Doctor Notes */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-medium text-muted-foreground">Doctor Notes</h4>
                {userRole === "DOCTOR" &&
                  action !== "notes" &&
                  appointment.status !== "CANCELLED" && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setAction("notes")}
                      className="h-7 text-emerald-400 hover:text-emerald-300 hover:bg-emerald-900/20"
                    >
                      <Edit className="h-3.5 w-3.5 mr-1" />
                      {appointment.notes ? "Edit" : "Add"}
                    </Button>
                  )}
              </div>

              {userRole === "DOCTOR" && action === "notes" ? (
                <div className="space-y-3">
                  <Textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Enter your clinical notes here..."
                    className="bg-background border-emerald-900/20 min-h-[100px]"
                  />
                  <div className="flex justify-end space-x-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => { setAction(null); setNotes(appointment.notes || ""); }}
                      disabled={notesLoading}
                      className="border-emerald-900/30"
                    >
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      onClick={handleSaveNotes}
                      disabled={notesLoading}
                      className="bg-emerald-600 hover:bg-emerald-700"
                    >
                      {notesLoading ? (
                        <><Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />Saving...</>
                      ) : (
                        "Save Notes"
                      )}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="p-3 rounded-md bg-muted/20 border border-emerald-900/20 min-h-[80px]">
                  {appointment.notes ? (
                    <p className="text-white whitespace-pre-line">{appointment.notes}</p>
                  ) : (
                    <p className="text-muted-foreground italic">No notes added yet</p>
                  )}
                </div>
              )}
            </div>

            {/* Patient: Download Prescription
                If prescriptionUrl already exists, download directly from Cloudinary.
                Otherwise generate the PDF first (uploads to Cloudinary, anchors on chain). */}
            {userRole === "PATIENT" && appointment.notes && (
              <div className="space-y-2">
                <h4 className="text-sm font-medium text-muted-foreground">Prescription</h4>
                {appointment.prescriptionUrl ? (
                  // Already generated — download directly, no server round-trip needed
                  <a
                    href={appointment.prescriptionUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    download={`prescription_${appointment.id}.pdf`}
                    onClick={handleDirectDownload}
                  >
                    <Button className="w-full bg-emerald-600 hover:bg-emerald-700">
                      <Download className="h-4 w-4 mr-2" />
                      Download Prescription PDF
                    </Button>
                  </a>
                ) : (
                  // Not generated yet — call server action to build PDF, upload to Cloudinary, anchor on chain
                  <Button
                    className="w-full bg-emerald-600 hover:bg-emerald-700"
                    onClick={handleDownloadPrescription}
                    disabled={pdfLoading}
                  >
                    {pdfLoading ? (
                      <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Generating PDF...</>
                    ) : (
                      <><Download className="h-4 w-4 mr-2" />Generate &amp; Download Prescription</>
                    )}
                  </Button>
                )}
              </div>
            )}

            {/* Patient: Share prescription with this doctor.
                Always shows a dropdown of ALL the patient's prescriptions across
                all appointments (including the current one if it has one).
                This way the patient can always pick any prescription — from any
                doctor, any appointment — and share it with the current doctor.
                Blockchain integrity is verified server-side before sharing. */}
            {userRole === "PATIENT" && appointment.status === "SCHEDULED" && (() => {
              // All appointments that have a prescriptionUrl, including current
              const allShareable = allPatientAppointments.filter(
                (a) => a.prescriptionUrl
              );

              // Also include current appointment if it has one and isn't in the list
              const currentIncluded = allShareable.some((a) => a.id === appointment.id);
              const shareableList = (appointment.prescriptionUrl && !currentIncluded)
                ? [appointment, ...allShareable]
                : allShareable;

              if (shareableList.length === 0) return null;

              return (
                <div className="space-y-2">
                  <h4 className="text-sm font-medium text-muted-foreground">
                    Share Prescription with Doctor
                  </h4>
                  <p className="text-xs text-muted-foreground">
                    Select any of your prescriptions to share with this doctor.
                    Blockchain integrity is verified automatically before sharing.
                  </p>

                  {/* Dropdown — all prescriptions across all appointments */}
                  <select
                    className="w-full rounded-md border border-emerald-900/40 bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-emerald-700"
                    value={selectedSourceId}
                    onChange={(e) => setSelectedSourceId(e.target.value)}
                  >
                    <option value="">— Select a prescription —</option>
                    {shareableList.map((a) => (
                      <option key={a.id} value={a.id}>
                        {format(new Date(a.startTime), "MMM d, yyyy")}
                        {" — Dr. "}{a.doctor?.name ?? "Unknown"}
                        {a.doctor?.specialty ? ` (${a.doctor.specialty})` : ""}
                        {a.id === appointment.id ? " (this appointment)" : ""}
                      </option>
                    ))}
                  </select>

                  <Button
                    variant="outline"
                    className="w-full border-emerald-900/40 hover:border-emerald-700/60"
                    onClick={() => handleUploadPrescription(selectedSourceId)}
                    disabled={uploadLoading || !selectedSourceId}
                  >
                    {uploadLoading ? (
                      <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Sharing...</>
                    ) : (
                      <><Upload className="h-4 w-4 mr-2" />Share Selected Prescription</>
                    )}
                  </Button>

                  {uploadData?.success && (
                    <p className="text-xs text-emerald-400">
                      ✓ Shared. Now grant blockchain access below.
                    </p>
                  )}
                  {uploadError && (
                    <div className="flex items-center gap-2 p-2 rounded-md bg-red-900/20 border border-red-900/30">
                      <AlertTriangle className="h-4 w-4 text-red-400 shrink-0" />
                      <p className="text-xs text-red-400">{uploadError.message}</p>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Patient: Grant blockchain access.
                Visible when:
                  - patient just generated & downloaded this session, OR
                  - blockchainRecordId is already in DB (prior session download), OR
                  - patient just successfully shared (uploadData.success) — covers cross-doctor case
                    where blockchainRecordId gets written to target appointment after refetch */}
            {userRole === "PATIENT" && (
              prescriptionDownloadedThisSession ||
              appointment.blockchainRecordId ||
              uploadData?.success
            ) && (
              <div className="space-y-2">
                <h4 className="text-sm font-medium text-muted-foreground">
                  Blockchain Access Control
                </h4>
                <p className="text-xs text-muted-foreground">
                  Grant your doctor cryptographic read access to verify the prescription
                  on the Quorum blockchain. Required before the doctor can verify it.
                </p>
                <Button
                  className="w-full bg-emerald-600 hover:bg-emerald-700"
                  onClick={handleGrantAccess}
                  disabled={grantLoading}
                >
                  {grantLoading ? (
                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Granting Access...</>
                  ) : (
                    <><ShieldCheck className="h-4 w-4 mr-2" />Grant Blockchain Access to Doctor</>
                  )}
                </Button>
              </div>
            )}

            {/* Doctor: Verify prescription integrity then view it.
                View is intentionally gated behind verify — the doctor should
                confirm the document is authentic before relying on it. */}
            {userRole === "DOCTOR" && appointment.uploadedPrescriptionUrl && (
              <div className="space-y-2">
                <h4 className="text-sm font-medium text-muted-foreground">
                  Prescription Verification
                </h4>

                {/* Verify result banner */}
                {verifyResult && (
                  <div className={`flex flex-col gap-2 p-3 rounded-md border text-sm ${
                    verifyResult.tampered
                      ? "bg-red-900/20 border-red-900/30 text-red-400"
                      : "bg-emerald-900/20 border-emerald-900/30 text-emerald-400"
                  }`}>
                    <div className="flex items-center gap-2">
                      {verifyResult.tampered ? (
                        <>
                          <AlertTriangle className="h-4 w-4 shrink-0" />
                          <span className="font-semibold">Document has been tampered with. Do not trust this prescription.</span>
                        </>
                      ) : (
                        <>
                          <ShieldCheck className="h-4 w-4 shrink-0" />
                          <span className="font-semibold">Verified ✅ — Hash matches blockchain record. Document is authentic.</span>
                        </>
                      )}
                    </div>
                    {/* Always show hashes for demo/transparency */}
                    <div className="font-mono text-xs break-all space-y-1 bg-black/20 rounded p-2">
                      <p>
                        <span className={verifyResult.tampered ? "text-red-300 font-bold" : "text-emerald-300 font-bold"}>
                          File hash (current):&nbsp;
                        </span>
                        <span className="text-muted-foreground">{verifyResult.recomputedHash}</span>
                      </p>
                      <p>
                        <span className="text-emerald-300 font-bold">Blockchain hash (original):&nbsp;</span>
                        <span className="text-muted-foreground">{verifyResult.onChainHash}</span>
                      </p>
                      {verifyResult.blockchainRecordId && (
                        <p className="text-muted-foreground">
                          Record ID: {verifyResult.blockchainRecordId}
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {/* Verify button */}
                <Button
                  variant="outline"
                  className="w-full border-emerald-900/30"
                  onClick={handleVerify}
                  disabled={verifyLoading}
                >
                  {verifyLoading ? (
                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Verifying on blockchain...</>
                  ) : verifyResult?.tampered ? (
                    <><ShieldX className="h-4 w-4 mr-2 text-red-400" />Tampered — Re-verify</>
                  ) : verifyResult?.verified ? (
                    <><ShieldCheck className="h-4 w-4 mr-2 text-emerald-400" />Verified — Check Again</>
                  ) : (
                    <><ShieldCheck className="h-4 w-4 mr-2 text-emerald-400" />Verify on Blockchain</>
                  )}
                </Button>

                {/* View/download — only shown after successful verification.
                    verifyResult.pdfUrl is only populated when verified=true (server sets it to null if tampered). */}
                {verifyResult?.verified && verifyResult?.pdfUrl && (
                  <a
                    href={verifyResult.pdfUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    download
                  >
                    <Button className="w-full bg-emerald-600 hover:bg-emerald-700">
                      <FileText className="h-4 w-4 mr-2" />
                      View Verified Prescription
                    </Button>
                  </a>
                )}
              </div>
            )}
            

          </div>

          <DialogFooter className="flex flex-col-reverse sm:flex-row sm:justify-between sm:space-x-2">
            <div className="flex gap-2">
              {canMarkCompleted() && (
                <Button
                  onClick={handleMarkCompleted}
                  disabled={completeLoading}
                  className="bg-emerald-600 hover:bg-emerald-700"
                >
                  {completeLoading ? (
                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Completing...</>
                  ) : (
                    <><CheckCircle className="mr-2 h-4 w-4" />Mark Complete</>
                  )}
                </Button>
              )}
              {appointment.status === "SCHEDULED" && (
                <Button
                  variant="outline"
                  onClick={handleCancelAppointment}
                  disabled={cancelLoading}
                  className="border-red-900/30 text-red-400 hover:bg-red-900/10 mt-3 sm:mt-0"
                >
                  {cancelLoading ? (
                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Cancelling...</>
                  ) : (
                    <><X className="h-4 w-4 mr-1" />Cancel Appointment</>
                  )}
                </Button>
              )}
            </div>
            <Button
              onClick={() => setOpen(false)}
              className="bg-emerald-600 hover:bg-emerald-700"
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}