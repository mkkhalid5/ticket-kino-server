const dns = require('node:dns');
dns.setServers(['8.8.8.8', '1.0.0.1']);

const express = require("express");
const dontenv = require("dotenv");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
dontenv.config();

const uri = process.env.MONGODB_URI;

const app = express();
const PORT = process.env.PORT;

app.use(
  cors({
    credentials: true,
    origin: [process.env.CLIENT_URL],
  }),
);
app.use(express.json());

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    await client.connect();
    const db = client.db("ticket-kino");

    const ticketCollections = db.collection("allticket");
    const advertiseCollections = db.collection("advertise");
    const userCollections = db.collection("user");
    const ticketBookingCollections = db.collection("userTicket");

    //get all user
    app.get('/api/ticket-kino/users', async (req, res) => {
      const users = await userCollections.find().toArray();
      res.send(users);
    });

    app.get('/api/ticket-kino/users/:email', async (req, res) => {
      const { email } = req.params;
      const users = await userCollections.find({ email: email }).toArray();
      res.send(users);
    });

    app.patch('/api/ticket-kino/users/:id', async (req, res) => {
      const { id } = req.params;
      const { role, status } = req.body;
      const user = await userCollections.findOne({
        _id: new ObjectId(id),
      });
      const result = await userCollections.updateOne(
        { _id: new ObjectId(id) },
        {
          $set: {
            role,
            status,
          },
        }
      );
      if (status === "fraud") {
        const deleteResult = await ticketCollections.deleteMany({
          vendorEmail: user.email,
        });
        console.log("Deleted tickets:", deleteResult.deletedCount);
      }
      res.send(result);
    });

    //get latest ticket 6
    app.get('/api/ticket-kino/latest-tickets', async (req, res) => {
      const tickets = await ticketCollections
        .find({
          adminApproval: "approved"
        })
        .sort({ createdAt: -1 })
        .limit(6)
        .toArray();

      res.send(tickets);
    });

    //get all tickets
    app.get('/api/ticket-kino/all-tickets', async (req, res) => {
      const tickets = await ticketCollections
        .find({
          adminApproval: "approved"
        })
        .toArray();
      console.log("tickets", tickets);
      res.send(tickets);
    });

    app.get('/api/ticket-kino/all-tickets/:id', async (req, res) => {
      const { id } = req.params;
      const tickets = await ticketCollections
        .find({
          adminApproval: "approved",
          _id: new ObjectId(id),
        })
        .toArray();

      res.send(tickets);
    });


    //get all advertise ticket
    app.get('/api/ticket-kino/advertise-tickets', async (req, res) => {
      const tickets = await ticketCollections
        .find({
          advertise: "true"
        })
        .limit(6)
        .toArray();

      res.send(tickets);
    });

    //create ticket
    app.post('/api/allticket', async (req, res) => {
      const ticket = req.body;
      console.log('req-Ticket:', ticket);
      const result = await ticketCollections.insertOne(ticket);
      console.log('result:', result);
      res.send(result);
    });

    app.get('/api/allticket', async (req, res) => {
      try {
        const query = {};
        if (req.query.vendorEmail) {
          query.vendorEmail = req.query.vendorEmail;
        }
        const tickets = await ticketCollections.find(query).toArray();
        res.send(tickets);
      } catch (e) {
        console.error("Error:", e);
        res.status(500).send({ error: "Internal Server Error" });
      }
    });

    app.patch('/api/allticket/:id', async (req, res) => {
      const { id } = req.params;
      const { status, ad } = req.body;
      const ticket = await ticketCollections.findOne({
        _id: new ObjectId(id),
      });

      if (ad === "true" && ticket.advertise !== "true") {
        const advertiseCount = await ticketCollections.countDocuments({
          advertise: "true",
        });

        if (advertiseCount >= 6) {
          return res.status(400).send({
            message: "Maximum advertisement limit reached",
          });
        }
      }
      const result = await ticketCollections.updateOne(
        { _id: new ObjectId(id) },
        {
          $set: {
            adminApproval: status,
            advertise: ad || "",
          },
        }
      );
      res.send({
        success: true,
        result,
      });
    });

    //user booked ticket
    app.post("/api/booking/ticket", async (req, res) => {
      try {
        const ticket = req.body;
        const ticketId = new ObjectId(ticket.ticketId);
        const ticketData = await ticketCollections.findOne({
          _id: ticketId,
        });
        console.log("ticket", ticket);
        if (ticketData.quantity < ticket.quantity) {
          return res.status(400).send({
            success: false,
            message: "Not enough tickets available",
          });
        }
        const bookingResult = await ticketBookingCollections.insertOne(ticket);
        console.log("q", ticket.quantity);
        await ticketCollections.updateOne(
          { _id: ticketId },
          {
            $inc: {
              quantity: -ticket.totalBuy,
            },
          }
        );
        res.send({
          success: true,
          bookingResult,
        });
      } catch (err) {
        res.status(500).send(err);
      }
    });

    app.patch("/api/booking/ticket/:id", async (req, res) => {
      try {
        const {id} = req.params;
        const { status } = req.body;
        const booking = await ticketBookingCollections.findOne({
          _id: new ObjectId(id),
        });
        await ticketBookingCollections.updateOne(
          { _id: new ObjectId(id) },
          {
            $set: {
              ticketStatus: status,
            },
          }
        );
        if (
          status === "rejected" &&
          booking.status !== "rejected"
        ) {
          await ticketCollections.updateOne(
            {
              _id: new ObjectId(booking.ticketId),
            },
            {
              $inc: {
                quantity: booking.totalBuy,
              },
            }
          );
        }
        res.send({success: true, message: "Booking Updated",});
      } catch (err) {
        res.status(500).send(err);
      }
    });

    //find all booked ticket by user
    app.get("/api/booking/ticket/", async (req, res) => {
      const result = await ticketBookingCollections.find().toArray();
      res.send(result)
    });

    //find ticket by userEmail
    app.get("/api/booking/ticket/:email", async (req, res) => {
      const { email } = req.params;
      const result = await ticketBookingCollections.find({ userEmail: email }).toArray();
      res.send(result)
    });


    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!",
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Server is running fine!");
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
