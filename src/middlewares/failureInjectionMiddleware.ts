import type { Request, Response, NextFunction } from 'express';
import { logTelemetry } from '../telemetry/logger';
import type { RequestWithTelemetry } from '../types/telemetry';

const FAIL_MODE = process.env.FAIL_MODE ?? 'none';

export default function failureInjectionMiddleware(
    req: Request,
    res: Response,
    next: NextFunction
): void {
    if (FAIL_MODE === 'auth' && req.path.startsWith('/auth')) {
        logTelemetry(
            req as RequestWithTelemetry,
            res,
            'ERROR',
            'system',
            'service.unavailable',
            'Auth service unavailable (FAIL_MODE=auth)',
            { error: { name: 'ServiceUnavailable', message: 'Auth service unavailable' } }
        );
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Auth service unavailable',
        });
        return;
    }

    if (FAIL_MODE === 'cart' && req.path.startsWith('/cart')) {
        logTelemetry(
            req as RequestWithTelemetry,
            res,
            'ERROR',
            'system',
            'service.unavailable',
            'Cart service unavailable (FAIL_MODE=cart)',
            { error: { name: 'ServiceUnavailable', message: 'Cart service unavailable' } }
        );
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Cart service unavailable',
        });
        return;
    }

    next();
}
