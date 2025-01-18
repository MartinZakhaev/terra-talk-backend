import { Request, Response, NextFunction } from "express";
import redisClient from "../utils/redis";

const CACHE_DURATION = 60 * 5; // 5 minutes

export const cacheMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const cacheKey = `cache:${req.method}:${req.originalUrl}`;

  try {
    const cachedData = await redisClient.get(cacheKey);
    if (cachedData) {
      res.json(JSON.parse(cachedData));
      return;
    }

    // Modify res.json to cache the response
    const originalJson = res.json;
    res.json = function (data) {
      redisClient.setEx(cacheKey, CACHE_DURATION, JSON.stringify(data));
      return originalJson.call(this, data);
    };

    next();
  } catch (error) {
    next();
  }
};
