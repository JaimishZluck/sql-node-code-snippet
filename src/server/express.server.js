import { createServer } from 'http';
import { errorHandler } from '../middlewares/error.middleware.js';
import { verifyUser } from '../middlewares/auth.middleware.js';
import morganMiddleware from '../logger/morgan.logger.js';
import figlet from 'figlet';
import router from '../routes/routes.js';
import express from "express";
import cors from "cors";
import boxen from "boxen";
const app = express();

// Apply CORS middleware first
app.use(
  cors({
    origin:
      process.env.CORS_ORIGIN === "*"
        ? "*"
        : process.env.CORS_ORIGIN?.split(","),
    credentials: true,
  })
);

// Apply other middlewares
app.use(express.json({ limit: "16kb" }));
app.use(express.urlencoded({ extended: true, limit: "16kb" }));
app.use(express.static("public"));
app.use(morganMiddleware);


// auth

app.use(verifyUser);
// Define routes
app.use("/LMS/api/v2", router);

// Root route
app.get("/", (req, res) => {
  res.send(`Welcome to App ${process.env.APP}`);
});

const httpServer = createServer(app);

// Error handling middleware (should be last)
app.use(errorHandler);

const startServer = () => {
  const port = process.env.PORT || 8080;
  const server = process.env.SERVER || "localhost";

  httpServer.listen(port, server, () => {
    const url = `http://${server}:${port}`;
    const message = `Server is running on ${url}`;

    // Calculate dynamic left padding for centering
    const terminalWidth = process.stdout.columns || 80;
    const boxWidth = message.length + 8; // Adjust for box padding and borders
    const leftPadding = Math.max(0, Math.floor((terminalWidth - boxWidth) / 2));

    const box = boxen(message, {
      padding: { top: 2, bottom: 2, left: 2, right: 2 },
      margin: { top: 1, bottom: 1, left: leftPadding, right: 0 },
      borderStyle: "round",
      borderColor: "blue",
      title: "L M S",
      titleAlignment: "center",
    });

    console.log(box);

    figlet("L M  S ! !", (err, data) => {
      if (err) {
        console.error("Something went wrong with figlet");
        return;
      }

      // Center the figlet output
      const terminalWidth = process.stdout.columns || 80;
      const lines = data.split("\n");
      const centeredFiglet = lines
        .map(line => line.padStart(Math.floor((terminalWidth + line.length) / 2)))
        .join("\n");

      console.log(centeredFiglet);
    });
  });
};

export default startServer;