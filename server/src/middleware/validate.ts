import { NextFunction, Request, Response } from "express";
import { ZodTypeAny } from "zod";

interface Schemas {
  // ZodTypeAny (not AnyZodObject) so a top-level .refine()/.superRefine()
  // schema — which wraps the object in a ZodEffects, not a ZodObject — can
  // still be passed here (e.g. "require at least one of these fields").
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
}

export function validate(schemas: Schemas) {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (schemas.body) req.body = schemas.body.parse(req.body);
      if (schemas.query) req.query = schemas.query.parse(req.query) as any;
      if (schemas.params) req.params = schemas.params.parse(req.params) as any;
      next();
    } catch (err) {
      next(err);
    }
  };
}
