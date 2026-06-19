const dns = require('node:dns');
dns.setServers(['1.1.1.1', '1.0.0.1']);

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

    //get all user
    app.get('/api/ticket-kino/users', async (req, res) => {
      const users = await userCollections.find().toArray();
      res.send(users);
    });

    app.get('/api/ticket-kino/users/:email', async (req, res) => {
      const {email} = req.params;
      const users = await userCollections.find({email:email}).toArray();
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

      const result = await ticketCollections.updateOne(
        { _id: new ObjectId(id) },
        {
          $set: {
            adminApproval: status,
            advertise: ad || ''
          }
        }
      );
      res.send(result);
    })


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
