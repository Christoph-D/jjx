import winston from "winston";
import { config } from "./vendor/winston-transport-vscode/logOutputChannelTransport";

export const logger = winston.createLogger({
  level: "warning",
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple(),
      ),
    }),
  ],
  levels: config.levels,
});
