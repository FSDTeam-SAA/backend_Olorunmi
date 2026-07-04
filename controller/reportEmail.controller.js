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
  const recipientEmail =
    req.body.recipientEmail ||
    req.body.recipient_email ||
    req.body.toEmail ||
    req.body.to_email ||
    req.body.email;
  const message = req.body.body || req.body.message;
  const fromEmail = req.body.fromEmail || req.body.from_email;
  const senderName =
    req.body.senderName ||
    req.body.sender_name ||
    req.user?.name ||
    req.user?._id;
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
    },
  );

  return sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Report PDF sent successfully",
    data: {
      recipientName,
      recipientEmail,
      senderName,
      fromEmail,
      fileName: pdf.originalname || "report.pdf",
    },
  });
});
