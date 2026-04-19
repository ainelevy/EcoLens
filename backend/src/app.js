const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const swaggerUi = require('swagger-ui-express');
const swaggerJsdoc = require('swagger-jsdoc');

const authRoutes = require('./routes/auth.routes');
const disposalRoutes = require('./routes/disposal.routes');
const airtimeRoutes = require('./routes/airtime.routes');

const app = express();

const swaggerSpec = swaggerJsdoc({
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'EcoLens API',
      version: '1.0.0',
      description: 'Smart Plastic Waste Disposal and Airtime Reward System',
    },
    servers: [{ url: 'http://localhost:3000' }],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      },
      schemas: {
        User: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            name: { type: 'string' },
            email: { type: 'string', format: 'email' },
            phone: { type: 'string' },
            userCode: { type: 'string', example: 'EC4A2B3C' },
            isActive: { type: 'boolean' },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        Balance: {
          type: 'object',
          properties: {
            currentPoints: { type: 'integer' },
            lifetimePoints: { type: 'integer' },
            airtimeEquivalent: { type: 'string', example: 'UGX 500' },
          },
        },
      },
    },
    tags: [
      { name: 'Auth', description: 'User registration and authentication' },
      { name: 'Disposal', description: 'Plastic waste disposal sessions and events' },
      { name: 'Airtime', description: 'Points redemption for airtime' },
    ],
    paths: {
      '/health': {
        get: {
          summary: 'Health check',
          tags: ['Auth'],
          responses: { 200: { description: 'Service is healthy' } },
        },
      },
      '/api/auth/register': {
        post: {
          summary: 'Register a new user',
          tags: ['Auth'],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['name', 'email', 'password', 'phone'],
                  properties: {
                    name: { type: 'string', example: 'Jane Doe' },
                    email: { type: 'string', example: 'jane@example.com' },
                    password: { type: 'string', minLength: 6, example: 'secret123' },
                    phone: { type: 'string', example: '+256700000000' },
                  },
                },
              },
            },
          },
          responses: {
            201: { description: 'User registered successfully' },
            400: { description: 'Validation error' },
            409: { description: 'Email already registered' },
          },
        },
      },
      '/api/auth/login': {
        post: {
          summary: 'Login and receive JWT token',
          tags: ['Auth'],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['email', 'password'],
                  properties: {
                    email: { type: 'string', example: 'jane@example.com' },
                    password: { type: 'string', example: 'secret123' },
                  },
                },
              },
            },
          },
          responses: {
            200: { description: 'Login successful, returns token' },
            401: { description: 'Invalid credentials' },
          },
        },
      },
      '/api/auth/profile': {
        get: {
          summary: 'Get current user profile and balance',
          tags: ['Auth'],
          security: [{ bearerAuth: [] }],
          responses: {
            200: { description: 'User profile with reward balance' },
            401: { description: 'Unauthorized' },
          },
        },
      },
      '/api/auth/phone': {
        put: {
          summary: 'Update phone number for airtime delivery',
          tags: ['Auth'],
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { phone: { type: 'string', example: '+256711111111' } },
                },
              },
            },
          },
          responses: { 200: { description: 'Phone updated' } },
        },
      },
      '/api/disposal/sessions/start': {
        post: {
          summary: 'Start a disposal session (called by IoT unit using userCode)',
          tags: ['Disposal'],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['userCode'],
                  properties: { userCode: { type: 'string', example: 'EC4A2B3C' } },
                },
              },
            },
          },
          responses: {
            201: { description: 'Session started' },
            404: { description: 'Invalid user code' },
          },
        },
      },
      '/api/disposal/events': {
        post: {
          summary: 'Record a classification event within a session',
          tags: ['Disposal'],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['sessionId', 'classifiedAs', 'confidence', 'isPlastic'],
                  properties: {
                    sessionId: { type: 'string', format: 'uuid' },
                    classifiedAs: { type: 'string', example: 'PET Bottle' },
                    confidence: { type: 'number', example: 0.97 },
                    isPlastic: { type: 'boolean', example: true },
                  },
                },
              },
            },
          },
          responses: { 201: { description: 'Event recorded, points awarded if plastic' } },
        },
      },
      '/api/disposal/sessions/end': {
        post: {
          summary: 'End an active disposal session',
          tags: ['Disposal'],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['sessionId'],
                  properties: { sessionId: { type: 'string', format: 'uuid' } },
                },
              },
            },
          },
          responses: { 200: { description: 'Session completed with summary' } },
        },
      },
      '/api/disposal/history': {
        get: {
          summary: 'Get paginated disposal event history',
          tags: ['Disposal'],
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
          ],
          responses: { 200: { description: 'Paginated disposal events' } },
        },
      },
      '/api/disposal/stats': {
        get: {
          summary: 'Get disposal statistics for the authenticated user',
          tags: ['Disposal'],
          security: [{ bearerAuth: [] }],
          responses: { 200: { description: 'User statistics including points and acceptance rate' } },
        },
      },
      '/api/airtime/redeem': {
        post: {
          summary: 'Redeem points for mobile airtime',
          tags: ['Airtime'],
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['points'],
                  properties: { points: { type: 'integer', minimum: 100, example: 200 } },
                },
              },
            },
          },
          responses: {
            200: { description: 'Airtime sent successfully' },
            400: { description: 'Insufficient points or below minimum' },
            502: { description: 'Africa\'s Talking API failed' },
          },
        },
      },
      '/api/airtime/history': {
        get: {
          summary: 'Get airtime redemption history',
          tags: ['Airtime'],
          security: [{ bearerAuth: [] }],
          responses: { 200: { description: 'List of past redemptions' } },
        },
      },
      '/api/airtime/callbacks/status': {
        post: {
          summary: "Africa's Talking async status callback (no auth)",
          tags: ['Airtime'],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    requestId: { type: 'string' },
                    status: { type: 'string', example: 'Success' },
                  },
                },
              },
            },
          },
          responses: { 200: { description: 'Callback received' } },
        },
      },
    },
  },
  apis: [],
});

app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

if (process.env.NODE_ENV !== 'test') app.use(morgan('dev'));

// Swagger UI
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, { customSiteTitle: 'EcoLens API Docs' }));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString(), service: 'ecolens-api' });
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/disposal', disposalRoutes);
app.use('/api/airtime', airtimeRoutes);

// 404
app.use((req, res) => {
  res.status(404).json({ error: 'Not Found', message: `Cannot ${req.method} ${req.path}` });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal Server Error' });
});

module.exports = app;
