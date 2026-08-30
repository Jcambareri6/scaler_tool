import { Router } from "express";
import { AuthService } from "./auth.services.js";

const authRouter = Router();

const authService = new AuthService();


authRouter.post("/test", (req, res) => {
    
    res.json({ ok: true });
});

authRouter.post("/register", async (req, res) => {
   

    try {

        const { email, password } = req.body;

        const data = await authService.register({
            email,
            password
        });
       

   return data

    } catch (error) {
        
        const message =
            error instanceof Error
                ? error.message
                : "registration failed";

        return res.status(500).json({ message });
    }
});

authRouter.post("/login", async (req, res) => {


    try {
        const { email, password } = req.body;

        const data = await authService.Login({
            email,
            password
        });

        return res.status(200).json(data);

    } catch (error) {
        const message =
            error instanceof Error
                ? error.message
                : "login failed";

        return res.status(500).json({ message });
    }
});

export default authRouter;