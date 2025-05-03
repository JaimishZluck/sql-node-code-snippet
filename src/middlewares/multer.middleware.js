import multer from "multer";
import path from "path";

// Define storage configuration with dynamic destination
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    // Define folder based on file type
    let folder = "./public/files"; // Default folder for non-images

    if (file.mimetype.startsWith("image/")) {
      folder = "./public/images"; // Set folder to 'images' for image files
    }

    cb(null, folder);
  },
  filename: function (req, file, cb) {
    // Get the file extension
    const fileExtension = path.extname(file.originalname);

    // Create a unique file name using Date.now and a random number
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);

    // Set the new file name with the original extension
    cb(null, file.fieldname + '-' + uniqueSuffix + fileExtension);
  }
});

// File filter to allow specific file types
const fileFilter = (req, file, cb) => {
  // Allow image, PDF, and CSV files
  const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/jpg', 'application/pdf', 'text/csv'];

  if (allowedMimeTypes.includes(file.mimetype)) {
    cb(null, true); // Accept the file
  } else {
    cb(new Error("Invalid file type. Only images, PDFs, and CSVs are allowed."), false); // Reject the file
  }
};

// Multer configuration
export const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 1024 * 1024 * 10 // Limit file size to 10 MB
  }
});
