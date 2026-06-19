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
