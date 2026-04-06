import type { Request, Response, NextFunction } from 'express';

const FAIL_MODE = process.env.FAIL_MODE ?? 'none';

export default function failureInjectionMiddleware(
    req: Request,
    res: Response,
    next: NextFunction
): void {
    if (FAIL_MODE === 'auth' && req.path.startsWith('/auth/signup')) {
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Auth service unavailable',
        });
        return;
    }

    if (FAIL_MODE === 'cart' && req.path.startsWith('/cart')) {
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Cart service unavailable',
        });
        return;
    }

    next();
}
