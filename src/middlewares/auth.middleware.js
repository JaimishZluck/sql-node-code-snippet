import axios from "axios";
import logger from "../logger/winston.logger.js"

export async function verifyUser(req, res, next) {
  try {
    const authToken = req.headers[ "authToken" ] || "";
    if (!authToken) {
      logger.error("Authorization token missing");
      return res
        .status(401)
        .json({ error_message: "Authorization token missing" });
    }

    const api = `${process.env.ERP_TOKEN_URL}/v1/user/verify-user`;

    const tokenData = {
      headers: {
        authToken: authToken,
        source: "bulk-mail",
      },
    };

    const loginAccess = await axios.get(api, tokenData);

    if (loginAccess.data.status !== "success") {
      logger.error(`Authorization failed: ${loginAccess.data.message}`);
      return res.status(403).json({ error_message: loginAccess.data.message });
    }

    logger.info(`User verified successfully: ${loginAccess.data.data.email || 'unknown user'}`);
    req.user = loginAccess.data.data;
    next();
  } catch (error) {
    if (error.response) {
      logger.error(`Authorization failed: ${error.response.data.message}`);
      return res
        .status(error.response.status)
        .json({
          error_message: error.response.data.message || "Authorization failed",
        });
    } else if (error.request) {
      logger.error("No response from authorization server");
      return res
        .status(500)
        .json({ error_message: "No response from authorization server" });
    } else {
      logger.error(`Internal Server Error: ${error.message}`);
      return res.status(500).json({ error_message: "Internal Server Error" });
    }
  }
}
