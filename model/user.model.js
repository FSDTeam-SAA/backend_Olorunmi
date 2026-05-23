import mongoose, { Schema, Document, Model } from "mongoose";
import bcrypt from "bcryptjs";

const userSchema = new Schema(
  {
    name: { type: String },
    email: { type: String },
    userId: { type: String, unique: true, sparse: true, trim: true },
    password: { type: String, select: 0 },
    textPassword: { type: String, select: 0, default: "" },
    username: { type: String },
    phone: { type: String },
    bio: { type: String, default: "" },
    credit: { type: Number, default: null },
    dob: { type: Date },
    gender: {
      type: String,
      enum: ["male", "female", "other"],
    },
    role: {
      type: String,
      default: "user",
      enum: ["user", "admin"],
    },
    avatar: {
      public_id: { type: String, default: "" },
      url: { type: String, default: "" },
    },
    enableNotifications: { type: Boolean, default: true },
    dnd: { type: Boolean, default: false },
    lastPost: { type: Date },
    totalPosts: { type: Number, default: 0 },
    address: {
      type: String,
    },
    location: {
      latitude: { type: Number },
      longitude: { type: Number },
    },
    defaultRadius: {
      type: Number,
      default: 100,
      min: 0,
    },
    verificationInfo: {
      verified: { type: Boolean, default: false },
      token: { type: String, default: "" },
    },
    password_reset_token: { type: String, default: "" },
    fine: { type: Number, default: 0 },
    refreshToken: { type: String, default: "" },
  },
  { timestamps: true }
);

// Pre save middleware: Hash password
userSchema.pre("save", async function (next) {
  const user = this;

  if (user.isModified("password")) {
    const saltRounds = Number(process.env.bcrypt_salt_round) || 10;
    user.password = await bcrypt.hash(user.password, saltRounds);
  }

  next();
});

userSchema.statics.isUserExistsByEmail = async function (email) {
  return await User.findOne({ email }).select("+password");
};

userSchema.statics.isUserExistsByUserId = async function (userId) {
  return await User.findOne({ userId }).select("+password");
};

userSchema.statics.isOTPVerified = async function (id) {
  const user = await User.findById(id).select("+verificationInfo");
  return user?.verificationInfo.verified;
};

userSchema.statics.isPasswordMatched = async function (
  plainTextPassword,
  hashPassword
) {
  return await bcrypt.compare(plainTextPassword, hashPassword);
};

export const User = mongoose.model("User", userSchema);
