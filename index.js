const express = require("express");
const cors = require("cors");
const app = express();
require("dotenv").config();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

const port = process.env.PORT || 3000;

//middleware
app.use(express.json());
app.use(cors());

const uri = `mongodb+srv://${process.env.DB_USERNAME}:${process.env.DB_PASSWORD}@simple-crud-server.hfigrlp.mongodb.net/?appName=simple-crud-server`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    const db = client.db("contest_hub_db");
    const contestsCollection = db.collection("contests");

    //contest apis
    app.post("/contests", async (req, res) => {
      const newContest = req.body;
      newContest.status = "pending";
      //   console.log(newContest)
      const result = await contestsCollection.insertOne(newContest);
      res.send(result);
    });

    app.get("/contests", async (req, res) => {
      const email = req.query.email;
      const query = {};
      if (email) {
        query.creatorMail = email;
      }
      const cursor = contestsCollection.find(query);
      const result = await cursor.toArray();
      res.send(result);
    });

    app.get("/allcontests", async (req, res) => {
      const query = { status: "confirmed" };
      const cursor = contestsCollection.find(query);
      const result = await cursor.toArray();
      res.send(result);
    });

    app.get("/contests/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await contestsCollection.findOne(query);
      res.send(result);
    });

    app.patch("/contests/:id", async (req, res) => {
      const id = req.params.id;
      const updatedContest = req.body;
      const query = { _id: new ObjectId(id) };
      const update = {
        $set: {
          name: updatedContest.name,
          image: updatedContest.image,
          description: updatedContest.description,
          price: updatedContest.price,
          prizeMoney: updatedContest.prizeMoney,
          taskInstruction: updatedContest.taskInstruction,
          contestType: updatedContest.contestType,
          deadline: updatedContest.deadline,
        },
      };
      const result = await contestsCollection.updateOne(query, update);
      res.send(result);
    });


    app.delete("/contests/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await contestsCollection.deleteOne(query);
      res.send(result);
    });

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("contest hub server running!");
});

app.listen(port, () => {
  console.log(`contest hub server listening on port ${port}`);
});
