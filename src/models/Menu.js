const mongoose = require("mongoose");

const childMenuSchema = new mongoose.Schema(
  {
    id: {
      type: String,
      required: true,
    },
    label: {
      type: String,
      required: true,
      trim: true,
    },
    icon: {
      type: String,
      default: null,
    },
    path: {
      type: String,
      default: null,
    },
    feature: {
      type: String,
      default: null,
      lowercase: true,
      trim: true,
    },
    roles: {
      type: [String],
      default: ["admin"],
      lowercase: true,
    },
    order: {
      type: Number,
      default: 0,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { _id: false },
);

const menuSchema = new mongoose.Schema(
  {
    documentNumber: {
      type: String,
      unique: true,
      sparse: true,
      index: true,
    },
    appCode: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      default: "truebill",
      index: true,
    },
    group: {
      type: String,
      required: true,
      trim: true,
    },
    groupOrder: {
      type: Number,
      default: 0,
    },
    label: {
      type: String,
      required: true,
      trim: true,
    },
    icon: {
      type: String,
      default: null,
    },
    path: {
      type: String,
      default: null,
    },
    feature: {
      type: String,
      default: null,
      lowercase: true,
      trim: true,
    },
    roles: {
      type: [String],
      default: ["admin"],
      lowercase: true,
    },
    order: {
      type: Number,
      default: 0,
    },
    children: {
      type: [childMenuSchema],
      default: [],
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true },
);

menuSchema.index({
  appCode: 1,
  isActive: 1,
  groupOrder: 1,
  order: 1,
});

module.exports = mongoose.model("Menu", menuSchema);