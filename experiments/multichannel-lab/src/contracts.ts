import { z } from 'zod';
import { createHash } from 'node:crypto';
export const CONTRACT_VERSION = 'mogs-lab-v1';
export const ContextSchema = z.object({title:z.string().max(300).default(''),audience:z.enum(['new_customers','existing_customers','historical','unspecified']).default('unspecified'),legacyEligible:z.boolean().nullable().default(null),journey:z.string().max(300).default(''),subject:z.string().max(1000).default(''),preheader:z.string().max(1000).default(''),plainText:z.string().max(100000).default(''),region:z.string().max(100).default(''),date:z.string().max(100).default('')}).strict();
export type Context = z.infer<typeof ContextSchema>;
export type Surface = 'email'|'deck'|'creative';
export type Label = 'contradicting'|'consistent'|'valid_exception'|'unrelated'|'insufficient_context';
export type Locator = {kind:'html';path:string;field?:string}|{kind:'pdf';page:number;bbox:[number,number,number,number]}|{kind:'image';page:1;bbox:[number,number,number,number]};
export interface Unit {id:string;text:string;role:string;locator:Locator;context:string;confidence:number|null;uncertain:boolean;textHash?:string;contextHash?:string}
export interface Preview {page:number;file:string;mime:string;width:number;height:number;hash?:string}
export interface Extraction {surface:Surface;extractor:string;units:Unit[];previews:Preview[];status:'complete'|'partial';warnings:string[];pages:number}
export interface Asset {id:string;revision:string;sourceHash:string;contextHash:string;filename:string;mime:string;surface:Surface;context:Context;createdAt:string;status:'extracting'|'ready'|'partial'|'failed';extraction:Extraction|null;error:string|null;original:string;active:boolean}
export const FactsSchema = z.object({company:z.literal('MOGS'),plan:z.literal('Starter'),beforeMonthlyCents:z.literal(3000),monthlyCents:z.number().int().min(100).max(100000),annualCents:z.literal(28800),teamMonthlyCents:z.literal(8000),legacyMonthlyCents:z.literal(3000),legacyCutoff:z.string().min(1)}).strict();
export type Facts = z.infer<typeof FactsSchema>;
export interface Check {name:string;pass:boolean;detail:string}
export interface Finding {id:string;assetId:string;revision:string;unitId:string;label:Label;kind:string;original:string;replacement:string|null;rationale:string;withholdReason:string|null;checks:Check[];locator:Locator}
export type AssetSnapshot = Omit<Asset,'original'|'active'>;
export interface LabRun {assetSnapshots?:AssetSnapshot[];id:string;contractVersion:typeof CONTRACT_VERSION;createdAt:string;completedAt:string|null;status:'queued'|'running'|'complete'|'partial'|'failed'|'cancelled';facts:Facts;factsHash:string;assetIds:string[];revisions:Record<string,string>;engine:string;findings:Finding[];errors:string[];counts:{assets:number;units:number;checked:number;suggestions:number;unresolved:number};durationMs:number;stale:boolean}
export const DEFAULT_FACTS:Facts={company:'MOGS',plan:'Starter',beforeMonthlyCents:3000,monthlyCents:4000,annualCents:28800,teamMonthlyCents:8000,legacyMonthlyCents:3000,legacyCutoff:'2026-10-03T07:00:00.000Z'};
export const hash=(value:string|Buffer):string=>createHash('sha256').update(value).digest('hex');
export const hashRecord=(value:unknown):string=>hash(JSON.stringify(value));
export const limits={fileBytes:10*1024*1024,requestBytes:15*1024*1024,pages:30,pixels:25000000,units:1000,assets:100,timeoutMs:30000};

export const LocatorSchema=z.discriminatedUnion('kind',[z.object({kind:z.literal('html'),path:z.string().min(1),field:z.string().optional()}).strict(),z.object({kind:z.literal('pdf'),page:z.number().int().positive(),bbox:z.tuple([z.number().nonnegative(),z.number().nonnegative(),z.number().nonnegative(),z.number().nonnegative()])}).strict(),z.object({kind:z.literal('image'),page:z.literal(1),bbox:z.tuple([z.number().nonnegative(),z.number().nonnegative(),z.number().nonnegative(),z.number().nonnegative()])}).strict()]);
export const ExtractionSchema=z.object({surface:z.enum(['email','deck','creative']),extractor:z.string().min(1),units:z.array(z.object({id:z.string().min(1),text:z.string(),role:z.string(),locator:LocatorSchema,context:z.string(),confidence:z.number().nullable(),uncertain:z.boolean(),textHash:z.string().optional(),contextHash:z.string().optional()}).strict()).max(limits.units),previews:z.array(z.object({page:z.number().int().positive(),file:z.string().min(1),mime:z.enum(['text/html','image/png','image/jpeg']),width:z.number().nonnegative(),height:z.number().nonnegative(),hash:z.string().optional()}).strict()).max(limits.pages),status:z.enum(['complete','partial']),warnings:z.array(z.string()),pages:z.number().int().positive().max(limits.pages)}).strict();
