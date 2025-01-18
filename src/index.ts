import { PrismaClient } from "@prisma/client";
import express from "express";
import cors from "cors";
import { createServer } from "http";
import { Server } from "socket.io";
import { cacheMiddleware } from "../middleware/cache";
import redisClient from "../utils/redis";

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: { origin: "http://localhost:3000", methods: ["GET", "POST"] },
});
const prisma = new PrismaClient();

app.use(express.json());
app.use(
  cors({
    origin: "http://localhost:3000",
    methods: ["GET", "POST"],
  })
);

// app.get("/", (req, res) => {
//   res.send("Hello World!");
// });

app.get(
  "/api/users/:userId/conversations",
  cacheMiddleware,
  async (req, res) => {
    const { userId } = req.params;
    const { page = 1, limit = 20 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    try {
      const conversations = await prisma.conversation.findMany({
        where: {
          participants: {
            some: { userId },
          },
        },
        include: {
          participants: {
            select: {
              id: true,
              userId: true,
              user: {
                select: {
                  firstName: true,
                  lastName: true,
                  username: true,
                  avatar: true,
                },
              },
            },
          },
          messages: {
            orderBy: {
              createdAt: "desc",
            },
            take: 1,
            select: {
              id: true,
              content: true,
              createdAt: true,
              senderId: true,
              sender: {
                select: {
                  firstName: true,
                  lastName: true,
                  username: true,
                },
              },
            },
          },
        },
        orderBy: {
          updatedAt: "desc",
        },
        take: Number(limit),
        skip,
      });

      const total = await prisma.conversation.count({
        where: {
          participants: {
            some: { userId },
          },
        },
      });

      res.json({
        conversations,
        hasMore: skip + conversations.length < total,
        total,
      });
    } catch (error) {
      console.error("Error fetching conversations:", error);
      res
        .status(500)
        .json({ error: "An error occurred while fetching conversations" });
    }
  }
);

app.post("/api/conversations", async (req, res) => {
  const { inviterId, inviteeEmail } = req.body;

  try {
    const invitee = await prisma.user.findUnique({
      where: { email: inviteeEmail },
    });

    if (!invitee) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const conversation = await prisma.conversation.create({
      data: {
        participants: {
          create: [{ userId: inviterId }, { userId: invitee.id }],
        },
      },
      include: {
        participants: {
          include: {
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                username: true,
                avatar: true,
              },
            },
          },
        },
      },
    });

    res.json(conversation);
  } catch (error) {
    res
      .status(500)
      .json({ error: "An error occurred while creating conversation" });
  }
});

app.get(
  "/api/conversations/:conversationId/messages",
  cacheMiddleware,
  async (req, res) => {
    const { conversationId } = req.params;

    try {
      const messages = await prisma.message.findMany({
        where: { conversationId },
        include: { sender: true },
        orderBy: { createdAt: "asc" },
      });

      res.json(messages);
    } catch (error) {
      res
        .status(500)
        .json({ error: "An error occurred while fetching messages" });
    }
  }
);

app.post("/api/conversations/:conversationId/messages", async (req, res) => {
  const { conversationId } = req.params;
  const { senderId, content } = req.body;

  try {
    const message = await prisma.message.create({
      data: {
        content,
        senderId,
        conversationId,
      },
      include: {
        sender: {
          select: {
            firstName: true,
            lastName: true,
            username: true,
            avatar: true,
          },
        },
      },
    });

    res.json(message);
  } catch (error) {
    res.status(500).json({ error: "An error occurred while sending message" });
  }
});

io.on("connection", (socket) => {
  // console.log(`A user connected ${socket.id}`);

  socket.on("send_message", async (message) => {
    // console.log(`Message from ${socket.id}: ${data.message}`);
    // io.emit("receive_message", data);
    await redisClient.del(
      `cache:GET:/api/conversations/${message.conversationId}/messages`
    );
    await redisClient.del(
      `cache:GET:/api/users/${message.senderId}/conversations`
    );
    socket.broadcast.emit("new_message", message);
  });

  socket.on("disconnect", () => {
    // console.log(`User disconnected ${socket.id}`);
  });
});

const PORT = process.env.PORT || 7777;
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
