import {supabase } from "../../lib/supabase.js";
import type {LoginInput, RegisterInput} from './auth.types.js';
 export class AuthService {
    async register ({email,password}: RegisterInput) {
        const {data,error} = await supabase.auth.signUp({
            email,
            password,
        });
        if(error){
            throw new Error(error.message);
        }
        console.log(data); 
        return data 
    }
    async Login ({email,password}: LoginInput) {
        const {data,error} = await supabase.auth.signInWithPassword({
            email,
            password
        })
        if(error){
            throw new Error(error.message);
        }
        return data ;
    }

    async refresh(refreshToken: string) {
        const { data, error } = await supabase.auth.refreshSession({
            refresh_token: refreshToken,
        });
        if (error) {
            throw new Error(error.message);
        }
        return data;
    }

    // skipBrowserRedirect: en el server no hay `window`, asi que
    // signInWithOAuth nunca redirige solo — devuelve la url para que el
    // frontend haga window.location.href = url.
    async getOAuthUrl(provider: "google" | "github", redirectTo: string) {
        const { data, error } = await supabase.auth.signInWithOAuth({
            provider,
            options: { redirectTo, skipBrowserRedirect: true },
        });
        if (error) {
            throw new Error(error.message);
        }
        return data;
    }
 }