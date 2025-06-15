import express from "express";
import {
  getPresignedUrl,
  removeFileFromKnowledge,
  uploadFileToKnowledge,
} from "../utils/rag.js";
import { getFilesFromUser } from "../utils/crud.js";

const router = express.Router();

router.post("/get-presigned-url", async (req, res) => {
  try {
    const url = await getPresignedUrl(req.body.fileName, req.body.fileType);
    res.status(200).json({ url });
  } catch (error) {
    res.status(401).json({ message: error.message });
  }
});

router.post("/process-file", async (req, res) => {
  try {
    const userID = req.userId;
    const url = await uploadFileToKnowledge(
      userID,
      req.body.fileName,
      req.body.fileType
    );
    res.status(200).json({ url });
  } catch (error) {
    res.status(401).json({ message: error.message });
  }
});

router.post("/delete-file", async (req, res) => {
  try {
    const userID = req.userId;
    const fileName = req.body.fileName;
    await removeFileFromKnowledge(userID, fileName);
    res.status(200).json({ message: "File deleted successfully" });
  } catch (error) {
    res.status(401).json({ message: error.message });
  }
});

router.get("/list-files", async (req, res) => {
  try {
    const userID = req.userId;
    const files = await getFilesFromUser(userID);
    res.status(200).json(files);
  } catch (error) {
    res.status(401).json({ message: error.message });
  }
});

export default router;
