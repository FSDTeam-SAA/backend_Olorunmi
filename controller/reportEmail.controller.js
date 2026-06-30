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

const isEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value));

const getUploadedReportPdf = (files) => {
  if (!files) {
    return null;
  }

  if (Array.isArray(files)) {
    return files[0] || null;
  }

  return files.pdf?.[0] || files.file?.[0] || files.reportPdf?.[0] || null;
};

const buildReportPdfEmailTemplate = ({ recipientName, message, senderName }) => {
  const safeRecipientName = escapeHtml(recipientName);
  const safeMessage = escapeHtml(message).replace(/\r?\n/g, "<br />");
  const safeSenderName = escapeHtml(senderName || "The team");

  return `
    <div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.5;">
      <p>Hello ${safeRecipientName},</p>
      <div>${safeMessage}</div>
      <p>Please find the attached PDF report.</p>
      <p>Regards,<br />${safeSenderName}</p>
    </div>
  `;
};

export const sendReportPdfEmail = catchAsync(async (req, res) => {
  const recipientName =
    req.body.recipientName || req.body.recipient_name || req.body.name;
  const recipientEmail =
    req.body.recipientEmail || req.body.recipient_email || req.body.email;
  const message = req.body.message;
  const subject = req.body.subject || "Report PDF";
  const pdf = getUploadedReportPdf(req.files);

  if (!recipientName || !recipientEmail || !message) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "recipientName, recipientEmail and message are required",
    );
  }

  if (!isEmail(recipientEmail)) {
    throw new AppError(httpStatus.BAD_REQUEST, "Invalid recipientEmail");
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

  const isPdf =
    pdf.mimetype === "application/pdf" ||
    pdf.originalname?.toLowerCase().endsWith(".pdf");

  if (!isPdf) {
    throw new AppError(httpStatus.BAD_REQUEST, "Only PDF files are allowed");
  }

  await sendEmail(
    recipientEmail,
    subject,
    buildReportPdfEmailTemplate({
      recipientName,
      message,
      senderName: req.user?.name,
    }),
    {
      text: message,
      attachments: [
        {
          filename: pdf.originalname || "report.pdf",
          content: pdf.buffer,
          contentType: pdf.mimetype || "application/pdf",
        },
      ],
    },
  );

  return sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Report PDF sent successfully",
    data: {
      recipientName,
      recipientEmail,
      fileName: pdf.originalname || "report.pdf",
    },
  });
});