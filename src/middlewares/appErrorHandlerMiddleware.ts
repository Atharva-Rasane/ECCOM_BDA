import type { NextFunction, Request, Response } from 'express';
import { setFlashMessage } from '../utilities';
import { logTelemetry } from '../telemetry/logger';
import type { RequestWithTelemetry } from '../types/telemetry';

export default (
    error,
    req: Request,
    res: Response,
    next: NextFunction
): void => {
    if (res.headersSent) {
        next(error);
        return;
    }

    if (error.name === 'TimeoutError' && error.http_code === 499) {
        logTelemetry(
            req as RequestWithTelemetry,
            res,
            'ERROR',
            'system',
            'request.timeout',
            `Request timed out: ${req.method} ${req.originalUrl}`,
            { error: { name: error.name, message: error.message } }
        );
        setFlashMessage(req, {
            type: 'info',
            message: 'You might be experiencing some network issues...',
        });
        res.status(500).send('Network timeout. Please retry.');
        return;
    }

    const message =
        typeof error.message === 'string' && error.message.length > 0
            ? error.message
            : 'Something went wrong. If this persists, contact support.';

    logTelemetry(
        req as RequestWithTelemetry,
        res,
        'ERROR',
        'system',
        'unhandled.error',
        `Unhandled error: ${message}`,
        { error: { name: error.name ?? 'Error', message, stack: error.stack?.split('\n')[1]?.trim() } }
    );

    if (typeof error.message === 'string' && error.message.length > 0) {
        if (req.session) {
            setFlashMessage(req, {
                type: 'danger',
                message: error.message,
            });
            res.status(500).send(error.message);
        } else {
            res.status(500).send(error.message);
        }
        return;
    }

    console.log(error);
    res.status(500).send(
        'Something went wrong. If this persists, contact support.'
    );
};
