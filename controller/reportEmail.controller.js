import httpStatus from "http-status";
import AppError from "../errors/AppError.js";
import catchAsync from "../utils/catchAsync.js";
import sendResponse from "../utils/sendResponse.js";
import { sendEmail } from "../utils/sendEmail.js";

const escapeHtml = (value = "") =>
  String(value).replace(/[&<>"']/g, (char) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[char];
  });

const isEmail = (value) =>
  /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(String(value).trim());

const collectRecipientValues = (value) => {
  if (value === undefined || value === null) {
    return [];
  }

  if (Array.isArray(value)) {
    return value.flatMap(collectRecipientValues);
  }

  const text = String(value).trim();
  if (!text) {
    return [];
  }

  if (text.startsWith("[") && text.endsWith("]")) {
    try {
      const parsedValue = JSON.parse(text);
      if (Array.isArray(parsedValue)) {
        return collectRecipientValues(parsedValue);
      }
    } catch {
      // Fall back to comma splitting below.
    }
  }

  return text
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
};

const normalizeRecipientEmails = (body = {}) => {
  const candidates = [
    ...collectRecipientValues(body.toEmails),
    ...collectRecipientValues(body.to_emails),
    ...collectRecipientValues(body.recipientEmails),
    ...collectRecipientValues(body.recipient_emails),
    ...collectRecipientValues(body.recipientEmail),
    ...collectRecipientValues(body.recipient_email),
    ...collectRecipientValues(body.toEmail),
    ...collectRecipientValues(body.to_email),
    ...collectRecipientValues(body.email),
  ];

  const normalizedEmails = [];
  const seen = new Set();

  for (const candidate of candidates) {
    const email = candidate.trim().toLowerCase();
    if (!email || seen.has(email)) continue;
    seen.add(email);
    normalizedEmails.push(email);
  }

  return normalizedEmails;
};

const invalidEmails = (emails) => emails.filter((email) => !isEmail(email));

const getUploadedReportPdf = (files) => {
  if (!files) {
    return null;
  }

  if (Array.isArray(files)) {
    return files[0] || null;
  }

  return files.pdf?.[0] || files.file?.[0] || files.reportPdf?.[0] || null;
};

const buildReportPdfEmailTemplate = ({ message, senderName, fromEmail }) => {
  const safeMessage = escapeHtml(message).replace(/\r?\n/g, "<br />");
  const safeSenderName = escapeHtml(senderName || "Unknown user");
  const safeFromEmail = escapeHtml(fromEmail || "Not provided");

  return `
    <div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.5;">
      <p>Hello,</p>
      <p>A daily log report has been sent by:</p>
      <p>
        <strong>Name:</strong> ${safeSenderName}<br />
        <strong>From Email:</strong> ${safeFromEmail}
      </p>
      <p><strong>Message:</strong></p>
      <div>${safeMessage}</div>
      <p>Please find the report PDF attached.</p>
      <p>Thank you.</p>
    </div>
  `;
};

export const sendReportPdfEmail = catchAsync(async (req, res) => {
  const recipientName =
    req.body.recipientName || req.body.recipient_name || req.body.name;
  const normalizedToEmails = normalizeRecipientEmails(req.body);
  const message = req.body.body || req.body.message || "";
  const fromEmail = (req.body.fromEmail || req.body.from_email || "").trim();
  const senderName =
    req.body.senderName ||
    req.body.sender_name ||
    req.user?.name ||
    req.user?._id;
  const subject = req.body.subject || "Report PDF";
  const pdf = getUploadedReportPdf(req.files);

  if (!normalizedToEmails.length) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "At least one recipient email is required",
    );
  }

  const invalidRecipientEmails = invalidEmails(normalizedToEmails);
  if (invalidRecipientEmails.length) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      `Invalid recipient email address(es): ${invalidRecipientEmails.join(", ")}`,
    );
  }

  if (fromEmail && !isEmail(fromEmail)) {
    throw new AppError(httpStatus.BAD_REQUEST, "Invalid fromEmail");
  }

  if (!pdf) {
    throw new AppError(httpStatus.BAD_REQUEST, "PDF file is required");
  }

  console.log("PDF file received:", {
    originalname: pdf.originalname,
    mimetype: pdf.mimetype,
    size: pdf.size,
  });
  console.log("Request body:", req.body);
  console.log("[REPORT EMAIL] fromEmail=", fromEmail);
  console.log("[REPORT EMAIL] toEmails count=", normalizedToEmails.length);
  console.log("[REPORT EMAIL] toEmails=", normalizedToEmails);
  console.log("[REPORT EMAIL] validation passed");

  const isPdf =
    pdf.mimetype === "application/pdf" ||
    pdf.originalname?.toLowerCase().endsWith(".pdf");

  if (!isPdf) {
    throw new AppError(httpStatus.BAD_REQUEST, "Only PDF files are allowed");
  }

  console.log("[REPORT EMAIL] sending report email");
  await sendEmail(
    normalizedToEmails,
    subject,
    buildReportPdfEmailTemplate({
      message,
      senderName,
      fromEmail,
    }),
    {
      text: `Hello,

A daily log report has been sent by:

Name: ${senderName || "Unknown user"}
From Email: ${fromEmail || "Not provided"}

Message:
${message}

Please find the report PDF attached.

Thank you.`,
      attachments: [
        {
          filename: pdf.originalname || "report.pdf",
          content: pdf.buffer,
          contentType: pdf.mimetype || "application/pdf",
        },
      ],
      replyTo: fromEmail || undefined,
    },
  );

  return sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Report PDF sent successfully",
    data: {
      recipientName,
      recipientEmail: normalizedToEmails[0],
      recipientEmails: normalizedToEmails,
      senderName,
      fromEmail,
      fileName: pdf.originalname || "report.pdf",
    },
  });
});
