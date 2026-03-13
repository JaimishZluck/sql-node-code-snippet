import jwt from "jsonwebtoken";
import logger from "../logger/winston.logger.js";
import config from "../config/env.config.js";

// Utility function to create a JWT access token.
// TODO(project-setup): adjust payload and signing options for your auth model.
export const generateAccessToken = (payload, options = {}) => {
  return jwt.sign(payload, config.jwt.secret, {
    expiresIn: config.jwt.expiry,
    ...options,
  });
};

// Middleware factory to verify JWT tokens and (optionally) enforce roles.
// Example usage:
//   router.get("/secure-endpoint", verifyJWT(["admin"]), controller);
export const verifyJWT =
  (requiredRoles = []) =>
  (req, res, next) => {
    try {
      const authHeader = req.headers["authorization"] || "";
      const token = authHeader.startsWith("Bearer ")
        ? authHeader.slice(7)
        : null;

      if (!token) {
        logger.warn("verifyJWT: Missing Authorization header");
        return res.status(401).json({
          success: false,
          message: "Authentication token missing",
        });
      }

      const decoded = jwt.verify(token, config.jwt.secret);
      req.user = decoded;

      // Basic role-based access control placeholder.
      // TODO(project-setup): define user roles and permissions according to your domain model.
      if (
        Array.isArray(requiredRoles) &&
        requiredRoles.length > 0 &&
        !requiredRoles.includes(decoded.role)
      ) {
        logger.warn(
          `verifyJWT: Access denied for user with role "${decoded.role}"`
        );
        return res.status(403).json({
          success: false,
          message: "Insufficient permissions to access this resource",
        });
      }

      return next();
    } catch (error) {
      logger.error(`verifyJWT: Token verification failed - ${error.message}`);
      return res.status(401).json({
        success: false,
        message: "Invalid or expired authentication token",
      });
    }
  };

