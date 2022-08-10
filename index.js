const express = require('express')
const app = express()
require('dotenv').config()
const port = process.env.PORT || 5000
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const verify = require('jsonwebtoken/verify');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);


app.use(cors({ origin: "https://manufacturer-app-ea238.web.app" }))
// app.use(cors({ origin: "http://localhost:3000" }))
app.use(express.json())


const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.l9moh.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });


function verifyJWT(req, res, next) {
    const authHeader = req.headers.authorization
    if (!authHeader) {
        res.status(401).send({ message: "Unauthorized access" })
    }
    const token = authHeader.split(' ')[1]
    jwt.verify(token, process.env.ACCESS_TOKEN, function (err, decoded) {
        if (err) {
            res.status(403).send({ message: 'forbidden access' })
        }
        req.decoded = decoded
        next()
    });
}

async function run() {
    try {
        await client.connect();
        const toolCollection = client.db('plex_tools').collection('tools')
        const orderCollection = client.db('plex_tools').collection('orders')
        const userCollection = client.db('plex_tools').collection('users')
        const reviewCollection = client.db('plex_tools').collection('reviews')
        const paymentCollection = client.db('plex_tools').collection('payments')

        const verifyAdmin = async (req, res, next) => {
            const requester = req.decoded.email
            const requesterAccount = await userCollection.findOne({ email: requester })
            if (requesterAccount.role === 'admin') {
                next()
            }
            else {
                res.status(403).send({ message: "forbidden" })
            }
        }

        // Paymet api
        app.post("/create-payment-intent", verifyJWT, async (req, res) => {
            const tool = req.body;
            const price = tool.price;
            const amount = price * 100;
            const paymentIntent = await stripe.paymentIntents.create({
                amount: amount,
                currency: 'usd',
                payment_method_types: ['card']
            });
            res.send({ clientSecret: paymentIntent.client_secret })
        })

        // make admin
        app.put('/user/admin/:email', verifyJWT, verifyAdmin, async (req, res) => {
            const email = req.params.email
            const filter = { email: email }
            const updateDoc = {
                $set: { role: 'admin' },
            };
            const result = await userCollection.updateOne(filter, updateDoc)
            res.send(result)

        })

        app.get('/admin/:email', async (req, res) => {
            const email = req.params.email
            const user = await userCollection.findOne({ email: email })
            const isAdmin = user.role === 'admin'
            res.send({ admin: isAdmin })
        })

        app.delete('/deleteuser/:email', verifyJWT, verifyAdmin, async (req, res) => {
            const email = req.params.email
            const query = { email: email }
            const result = await userCollection.deleteOne(query)
            res.send(result)
        })

        // Load all user
        app.get('/alluser', verifyJWT, async (req, res) => {
            const query = {}
            const users = await userCollection.find(query).toArray()
            res.send(users)
        })
        // put user to db
        app.put('/user/:email', async (req, res) => {
            const email = req.params.email
            const user = req.body
            const filter = { email: email }
            const options = { upsert: true };
            const updateDoc = {
                $set: user,
            };
            const result = await userCollection.updateOne(filter, updateDoc, options)
            const token = jwt.sign({ email: email }, process.env.ACCESS_TOKEN, { expiresIn: '1h' })
            res.send({ result, token })
        })

        // update user
        app.put('/updateduser', verifyJWT, async (req, res) => {
            const email = req.query.email
            const updatedUser = req.body
            const filter = { email: email }
            const options = { upsert: true };
            const updateDoc = {
                $set: {
                    name: updatedUser.name,
                    img: updatedUser.img,
                    phone: updatedUser.phone,
                    education: updatedUser.education,
                    address: updatedUser.address,
                    linkedin: updatedUser.linkedin
                },
            };
            const result = await userCollection.updateOne(filter, updateDoc, options)
            res.send(result)
        })
        //
        app.get('/user', verifyJWT, async (req, res) => {
            const email = req.query.email
            const query = { email: email }
            const result = await userCollection.findOne(query)
            res.send(result)
        })
        // Get Six items
        app.get('/tools', async (req, res) => {
            const query = {}
            const tools = await toolCollection.find(query).limit(6).toArray()
            res.send(tools)
        })
        // Get All items
        app.get('/alltools', async (req, res) => {
            const query = {}
            const tools = await toolCollection.find(query).toArray()
            res.send(tools)
        })

        // find one item for puchase page
        app.get('/tool/:id', verifyJWT, async (req, res) => {
            const id = req.params.id
            const query = { _id: ObjectId(id) }
            const result = await toolCollection.findOne(query)
            res.send(result)
        })

        // put order in orders collection
        app.put('/order', verifyJWT, async (req, res) => {
            const order = req.body
            const filter = {
                email: order.email,
                toolId: order.toolId
            }
            const query = { _id: ObjectId(order.toolId) }
            const exist = await orderCollection.findOne(filter)
            const options = { upsert: true };
            if (exist) {
                const updatedDoc = {
                    $set: {
                        address: order.address,
                        phone: order.phone,
                        quantity: exist.quantity + order.quantity,
                        price: exist.price + order.price
                    }
                }
                const tool = await toolCollection.findOne(query)
                const updateTool = {
                    $set: {
                        quantity: tool.quantity - order.quantity
                    }
                }
                const updatedTool = await toolCollection.updateOne(query, updateTool, options)
                const updatedOrder = await orderCollection.updateOne(filter, updatedDoc, options)
                return res.send({ updatedOrder, updatedTool })
            }

            else {
                const tool = await toolCollection.findOne(query)
                const updateTool = {
                    $set: {
                        quantity: tool.quantity - order.quantity
                    }
                }
                const updatedTool = await toolCollection.updateOne(query, updateTool, options)
                const result = await orderCollection.insertOne(order)
                return res.send({ result, updatedTool })
            }
        })

        // user ordered api
        app.get('/myorder', verifyJWT, async (req, res) => {
            const email = req.query.email
            const authorization = req.headers.authorization
            const decodedEmail = req.decoded.email
            if (email === decodedEmail) {
                const query = { email: email }
                const orders = await orderCollection.find(query).toArray()
                return res.send(orders)
            }
            else {
                res.status(403).send({ message: 'forbidden access' })
            }
        })
        app.get('/allorders', verifyJWT, verifyAdmin, async (req, res) => {
            const result = await orderCollection.find().toArray()
            res.send(result)
        })

        // Patch for update payment status
        app.patch('/order/:id', verifyJWT, async (req, res) => {
            const id = req.params.id
            const payment = req.body
            const filter = { _id: ObjectId(id) }
            const updatedDoc = {
                $set: {
                    paid: true,
                    transactionId: payment.transactionId,
                }
            }
            const result = await paymentCollection.insertOne(payment)
            const updatedBooking = await orderCollection.updateOne(filter, updatedDoc)
            res.send(updatedDoc)
        })

        // Handle shift status by admin
        app.patch('/shifted/:id', verifyJWT, verifyAdmin, async (req, res) => {
            const id = req.params.id
            const filter = { _id: ObjectId(id) }
            const updateDoc = {
                $set: {
                    shifted: true
                }
            }
            const result = await orderCollection.updateOne(filter, updateDoc)
            res.send(result)
        })

        // add a new product by admin

        app.post('/addproduct', verifyJWT, verifyAdmin, async (req, res) => {
            const tool = req.body
            const result = await toolCollection.insertOne(tool)
            res.send(result)
        })

        // delete tool
        app.delete('/deletetool/:id', verifyJWT, verifyAdmin, async (req, res) => {
            const id = req.params.id
            const query = { _id: ObjectId(id) }
            const result = await toolCollection.deleteOne(query)
            res.send(result)

        })

        app.get('/order/:id', verifyJWT, async (req, res) => {
            const id = req.params.id
            const query = { _id: ObjectId(id) }
            const result = await orderCollection.findOne(query)
            res.send(result)
        })

        // add review
        app.put('/addreview', async (req, res) => {
            const review = req.body
            const query = { email: review.email }
            const options = { upsert: true };
            const user = await userCollection.findOne(query)
            console.log(user.img);
            if (user.img) {
                const updateDoc = {
                    $set: {
                        img: user.img,
                    }
                }
                const updatedUserReview = await reviewCollection.updateOne(query, updateDoc, options)
                const result = await reviewCollection.insertOne(review)
                return res.send({ result, updatedUserReview })
            }
            else {
                const result = await reviewCollection.insertOne(review)
                res.send(result)
            }

        })

        // get dummy reviews when user isn't log in
        app.get('/reviews', async (req, res) => {
            const reviews = await reviewCollection.find().toArray()
            res.send(reviews)
        })
    }
    finally {

    }
}
run().catch(console.dir)


app.get('/', (req, res) => {
    res.send("Hello from Plex Tools")
})
app.listen(port, () => {
    console.log("Plex app running on", port);
})