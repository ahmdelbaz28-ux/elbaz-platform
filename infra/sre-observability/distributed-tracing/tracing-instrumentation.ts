import { trace, context, propagation, SpanStatusCode, type Span, type Tracer } from '@opentelemetry/api';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { RedisInstrumentation } from '@opentelemetry/instrumentation-redis-4';
import { MySQLInstrumentation } from '@opentelemetry/instrumentation-mysql';
import { Resource } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION, ATTR_DEPLOYMENT_ENVIRONMENT } from '@opentelemetry/semantic-conventions';
import { BatchSpanProcessor, SimpleSpanProcessor, ConsoleSpanExporter } from '@opentelemetry/sdk-trace-base';
import { AlwaysOnSampler, TraceIdRatioBasedSampler } from '@opentelemetry/sdk-trace-base';
import type { Context, HonoRequest } from 'hono';
import type { Bindings } from 'hono/types';

const OTEL_EXPORTER_OTLP_ENDPOINT = process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://otel-collector:4317';
const OTEL_SERVICE_NAME = process.env.OTEL_SERVICE_NAME || 'ahmedelbaz-lms-backend';
const OTEL_SERVICE_VERSION = process.env.OTEL_SERVICE_VERSION || '1.0.0';
const OTEL_DEPLOYMENT_ENVIRONMENT = process.env.OTEL_DEPLOYMENT_ENVIRONMENT || 'production';
const OTEL_TRACES_SAMPLER_RATIO = parseFloat(process.env.OTEL_TRACES_SAMPLER_RATIO || '1.0');

let sdk: NodeSDK | null = null;

export function setupTracing(): void {
  if (sdk) {
    return;
  }

  const resource = new Resource({
    [ATTR_SERVICE_NAME]: OTEL_SERVICE_NAME,
    [ATTR_SERVICE_VERSION]: OTEL_SERVICE_VERSION,
    [ATTR_DEPLOYMENT_ENVIRONMENT]: OTEL_DEPLOYMENT_ENVIRONMENT,
  });

  const otlpExporter = new OTLPTraceExporter({
    url: OTEL_EXPORTER_OTLP_ENDPOINT,
  });

  const consoleExporter = new ConsoleSpanExporter();

  const spanProcessors = [
    new BatchSpanProcessor(otlpExporter, {
      maxQueueSize: 2048,
      maxExportBatchSize: 512,
      scheduledDelayMillis: 5000,
      exportTimeoutMillis: 30000,
    }),
  ];

  if (OTEL_DEPLOYMENT_ENVIRONMENT === 'development') {
    spanProcessors.push(new SimpleSpanProcessor(consoleExporter));
  }

  const sampler = OTEL_TRACES_SAMPLER_RATIO >= 1.0
    ? new AlwaysOnSampler()
    : new TraceIdRatioBasedSampler(OTEL_TRACES_SAMPLER_RATIO);

  sdk = new NodeSDK({
    resource,
    spanProcessors,
    sampler,
    instrumentations: [
      new HttpInstrumentation({
        suppressInternalInstrumentation: true,
        requestHook: (span, request) => {
          if ('url' in request && typeof request.url === 'string') {
            span.setAttribute('http.url', request.url);
          }
        },
      }),
      new ExpressInstrumentation(),
      new RedisInstrumentation(),
      new MySQLInstrumentation(),
    ],
  });

  sdk.start();

  process.on('SIGTERM', () => {
    sdk?.shutdown().then(
      () => console.log('OpenTelemetry SDK shut down successfully'),
      (err) => console.error('Error shutting down OpenTelemetry SDK', err),
    );
  });
}

export function createTracingMiddleware<T extends Bindings>() {
  const tracer = trace.getTracer(OTEL_SERVICE_NAME, OTEL_SERVICE_VERSION);

  return async (c: Context<T>, next: () => Promise<void>) => {
    const path = new URL(c.req.url).pathname;
    const method = c.req.method;

    const span = tracer.startSpan(
      `${method} ${path}`,
      {
        kind: 1,
        attributes: {
          'http.method': method,
          'http.url': c.req.url,
          'http.target': path,
          'http.host': c.req.header('host') || 'unknown',
          'http.user_agent': c.req.header('user-agent') || 'unknown',
          'http.request_content_length': c.req.header('content-length'),
          'namespace': process.env.KUBERNETES_NAMESPACE || 'ahmedelbaz',
          'service.name': OTEL_SERVICE_NAME,
        },
      },
    );

    try {
      await next();

      span.setAttributes({
        'http.status_code': c.res.status,
        'http.response_content_length': c.res.headers.get('content-length'),
      });

      if (c.res.status >= 400) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: `HTTP ${c.res.status}`,
        });
      } else {
        span.setStatus({ code: SpanStatusCode.OK });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;

      span.setAttributes({
        'error.message': errorMessage,
        'error.stack': errorStack,
        'error.type': error instanceof Error ? error.constructor.name : 'UnknownError',
      });

      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: errorMessage,
      });

      span.recordException(error as Error);

      throw error;
    } finally {
      span.end();
    }
  };
}

export function traceDatabaseQuery(operation: string, query: string): Span {
  const tracer = trace.getTracer(OTEL_SERVICE_NAME, OTEL_SERVICE_VERSION);
  return tracer.startSpan(`${operation}`, {
    kind: 3,
    attributes: {
      'db.system': 'mysql',
      'db.operation': operation,
      'db.statement': query.length > 500 ? query.substring(0, 500) + '...' : query,
      'db.namespace': process.env.DB_NAME || 'lms_platform',
    },
  });
}

export function traceCacheOperation(operation: string, key: string): Span {
  const tracer = trace.getTracer(OTEL_SERVICE_NAME, OTEL_SERVICE_VERSION);
  return tracer.startSpan(`redis.${operation}`, {
    kind: 3,
    attributes: {
      'db.system': 'redis',
      'db.operation': operation,
      'redis.key': key,
    },
  });
}

export function traceExternalCall(service: string, endpoint: string): Span {
  const tracer = trace.getTracer(OTEL_SERVICE_NAME, OTEL_SERVICE_VERSION);
  return tracer.startSpan(`external.${service}`, {
    kind: 2,
    attributes: {
      'peer.service': service,
      'http.url': endpoint,
      'component': 'http_client',
    },
  });
}

export function getTracer(): Tracer {
  return trace.getTracer(OTEL_SERVICE_NAME, OTEL_SERVICE_VERSION);
}
