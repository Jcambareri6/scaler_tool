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
 }