import { Router, type IRouter } from "express";
import healthRouter from "./health";
import analysesRouter from "./analyses";
import flashRouter from "./flash";
import weeklyRouter from "./weekly";
import scorecardRouter from "./scorecard";
import outcomesRouter from "./outcomes";
import statusRouter from "./status";

const router: IRouter = Router();

router.use(healthRouter);
router.use(analysesRouter);
router.use(flashRouter);
router.use(weeklyRouter);
router.use(scorecardRouter);
router.use(outcomesRouter);
router.use(statusRouter);

export default router;
