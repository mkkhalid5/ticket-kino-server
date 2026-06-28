const dns = require('node:dns');
dns.setServers(['8.8.8.8', '1.0.0.1']);

const express = require("express");
const dontenv = require("dotenv");
const cors = require("cors");
const Stripe = require("stripe");
const cloudinary = require("cloudinary").v2;

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
dontenv.config();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const multer = require("multer");
const { createRemoteJWKSet, jwtVerify } = require('jose-cjs');
const storage = multer.memoryStorage();
const upload = multer({
  storage,
});

const uri = process.env.MONGODB_URI;

const app = express();
const PORT = process.env.PORT;

app.use(
  cors(),
);

app.use(express.json());

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

const JWKS = createRemoteJWKSet(new URL(`${process.env.CLIENT_URL}/api/auth/jwks`));

const verifyToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if(!authHeader || !authHeader.startsWith("Bearer")){
    return res.status(401).json({ msg: "Unauthorized"});
  }
  const token = authHeader.split(" ")[1];
  
  if(!token){
    return res.status(401).json({ msg: "Unauthorized"});
  }
  try{
    const {payload} = await jwtVerify(token, JWKS)
    req.user = payload;
    next();
  }
  catch(e){
    console.log(e);
    return res.status(401).json({ msg: "Unauthorized"});
  }
}

const adminVerify = async (req, res, next) => {
  const user = req.user;
  console.log("usar",user);
  if(user.role !== "admin"){{
    return res.status(403).json({ msg: "Forbidden Access"});
  }}
  next();
}

const travelerVerify = async (req, res, next) => {
  const user = req.user;
  console.log('user',user);
  if(user.role !== "traveler"){{
    return res.status(403).json({ msg: "Forbidden Access"});
  }}
  next();
}

async function run() {
  try {
    //  await client.connect();
    const db = client.db("ticket-kino");

    const ticketCollections = db.collection("allticket");
    const advertiseCollections = db.collection("advertise");
    const userCollections = db.collection("user");
    const ticketBookingCollections = db.collection("userTicket");

    app.post("/api/upload", upload.single("image"), async (req, res) => {

      //imageUpload Cloudinary
      try {
        const result = await new Promise((resolve, reject) => {
          cloudinary.uploader.upload_stream(
            {
              folder: "ticket-booking",
            },
            (error, result) => {
              if (error) return reject(error);
              resolve(result);
            }
          ).end(req.file.buffer);
        });
        res.send({
          image: result.secure_url,
        });
      } catch (err) {
        res.status(500).send(err);
      }
    });

    //get all user
    app.get('/api/ticket-kino/users',verifyToken,adminVerify, async (req, res) => {
      const users = await userCollections.find().toArray();
      res.send(users);
    });

    app.get('/api/ticket-kino/users/:email',verifyToken, async (req, res) => {
      const { email } = req.params;
      const users = await userCollections.find({ email: email }).toArray();
      res.send(users);
    });

    app.patch('/api/ticket-kino/users/:id',verifyToken, async (req, res) => {
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
    app.get("/api/ticket-kino/all-tickets", async (req, res) => {
      try {
        const {
          from,
          to,
          transportType,
          minPrice,
          maxPrice,
          sort,
        } = req.query;
        const query = {
          adminApproval: "approved",
        };
        if (from) {
          query.fromLocation = {
            $regex: from,
            $options: "i",
          };
        }
        if (to) {
          query.toLocation = {
            $regex: to,
            $options: "i",
          };
        }
        if (
          transportType &&
          transportType !== "all"
        ) {
          query.transportType = transportType;
        }
        if (minPrice || maxPrice) {
          query.price = {};
          if (minPrice) {
            query.price.$gte = Number(minPrice);
          }
          if (maxPrice) {
            query.price.$lte = Number(maxPrice);
          }
        }
        const sortOption = {};
        if (sort === "low") {
          sortOption.price = 1;
        }
        if (sort === "high") {
          sortOption.price = -1;
        }
        const tickets = await ticketCollections
          .find(query)
          .sort(sortOption)
          .toArray();
        res.send(tickets);
      } catch (err) {
        res.status(500).send({
          message: err.message,
        });
      }
    });

    app.get('/api/ticket-kino/all-tickets/:id',verifyToken, async (req, res) => {
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
    app.post('/api/allticket',verifyToken, async (req, res) => {
      try {
        const ticket = req.body;
        console.log("Ticket:", ticket);
        // MongoDB Insert
        const result = await ticketCollections.insertOne(ticket);
        // Stripe Product
        const product = await stripe.products.create({
          name: ticket.ticketTitle,
          description: `${ticket.fromLocation} → ${ticket.toLocation}`,
          images: [ticket.image],
          metadata: {
            ticketId: result.insertedId.toString()
          }
        });
        const usd = ticket.price / 120;
        // Stripe Price
        const stripePrice = await stripe.prices.create({
          product: product.id,
          // unit_amount_: ticket.price * 100,
          unit_amount: Math.round(usd * 100),
          currency: "usd",
        });
        // MongoDB Update
        await ticketCollections.updateOne(
          {
            _id: result.insertedId
          },
          {
            $set: {
              stripeProductId: product.id,
              stripePriceId: stripePrice.id
            }
          }
        );
        res.send({
          success: true,
          ticketId: result.insertedId,
          stripeProductId: product.id,
          stripePriceId: stripePrice.id
        });

      }
      catch (error) {
        console.log(error);
        res.status(500).send({
          success: false,
          message: error.message
        });
      }
    });

    app.get('/api/allticket',verifyToken, async (req, res) => {
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

    app.patch('/api/allticket/:id',verifyToken, async (req, res) => {
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
    app.post("/api/booking/ticket",verifyToken, travelerVerify, async (req, res) => {
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

    app.patch("/api/booking/ticket/:id",verifyToken, async (req, res) => {
      try {
        const { id } = req.params;
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
        res.send({ success: true, message: "Booking Updated", });
      } catch (err) {
        res.status(500).send(err);
      }
    });

    //find all booked ticket by user
    app.get("/api/booking/ticket/",verifyToken, async (req, res) => {
      const result = await ticketBookingCollections.find().toArray();
      res.send(result)
    });

    //find ticket by userEmail
    app.get("/api/booking/ticket/:email",verifyToken, async (req, res) => {
      const { email } = req.params;
      const result = await ticketBookingCollections.find({ userEmail: email }).toArray();
      res.send(result)
    });


    //stripe paymet api
    app.post("/api/create-checkout-session",verifyToken, async (req, res) => {
      try {
        const { bookingId } = req.body;
        const booking = await ticketBookingCollections.findOne({
          _id: new ObjectId(bookingId),
        });
        const session = await stripe.checkout.sessions.create({
          mode: "payment",
          payment_method_types: ["card"],
          line_items: [
            {
              price: booking.stripePriceId,
              quantity: booking.totalBuy,
            },
          ],
          success_url:
            `${process.env.CLIENT_URL}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url:
            `${process.env.CLIENT_URL}/payment-cancel`,
          metadata: {
            bookingId: booking._id.toString(),
          },
        });
        res.send({
          success: true,
          url: session.url,
        });
      } catch (err) {
        console.log(err);
        res.status(500).send({
          success: false,
          message: err.message,
        });
      }
    });


    app.post("/api/payment-success",verifyToken, async (req, res) => {
      try {
        const { sessionId } = req.body;
        const session = await stripe.checkout.sessions.retrieve(sessionId);
        if (session.payment_status !== "paid") {
          return res.send({
            success: false,
            message: "Payment not completed",
          });

        }
        const bookingId = session.metadata.bookingId;
        await ticketBookingCollections.updateOne(
          {
            _id: new ObjectId(bookingId),
          },
          {
            $set: {
              paymentStatus: "paid",
              paidAt: new Date(),
              stripeSessionId: session.id,
              stripeTrx: session.payment_intent
            },
          }
        );
        res.send({
          success: true,
        });
      } catch (err) {
        console.log(err);
        res.status(500).send({
          success: false,
          message: err.message,
        });
      }
    });


    // await client.db("admin").command({ ping: 1 });
    // console.log(
    //   "Pinged your deployment. You successfully connected to MongoDB!",
    // );
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
