import express from 'express';
import dotenv from 'dotenv';
import indexRoutes from './routes';

dotenv.config();

const app = express();

app.use(express.json());
app.use('/', indexRoutes);

export default app;
