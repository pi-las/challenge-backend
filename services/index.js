const fastify = require('fastify')({ logger: true });
const listenMock = require('../mock-server');
const CircuitBreaker = require('../utils/circuit-breaker');

// Initialize circuit breaker for addEvent endpoint
const addEventCircuitBreaker = new CircuitBreaker({
  failureThreshold: 3,       // Open circuit after 3 failures
  failureWindowMs: 30000,    // Within 30 second window
  resetTimeoutMs: 10000,     // Initial retry after 10 seconds
  maxResetTimeoutMs: 60000   // Max backoff of 60 seconds
});

fastify.get('/getUsers', async (request, reply) => {
    const resp = await fetch('http://event.com/getUsers');
    const data = await resp.json();
    reply.send(data);
});

fastify.post('/addEvent', async (request, reply) => {
  try {
    // Execute request through circuit breaker
    const result = await addEventCircuitBreaker.execute(async () => {
      const resp = await fetch('http://event.com/addEvent', {
        method: 'POST',
        body: JSON.stringify({
          id: new Date().getTime(),
          ...request.body
        })
      });

      // Check for HTTP error responses (like 503)
      if (!resp.ok) {
        const errorData = await resp.json();
        const error = new Error(errorData.message || 'External service error');
        error.status = resp.status;
        error.data = errorData;
        throw error;
      }

      return await resp.json();
    });

    reply.send(result);
  } catch(err) {
    // Handle circuit breaker specific errors
    if (err.circuitBreakerOpen) {
      const state = addEventCircuitBreaker.getState();
      return reply.status(503).send({
        success: false,
        error: 'Service temporarily unavailable',
        message: 'Event service is currently experiencing issues. Please try again later.',
        retryAfter: Math.ceil(state.nextRetryIn / 1000), // seconds
        circuitBreakerState: state.state
      });
    }

    // Handle other errors (network, external service errors)
    const status = err.status || 500;
    reply.status(status).send({
      success: false,
      error: err.message || 'Failed to add event',
      ...(err.data || {})
    });
  }
});

fastify.get('/getEvents', async (request, reply) => {  
    const resp = await fetch('http://event.com/getEvents');
    const data = await resp.json();
    reply.send(data);
});

fastify.get('/getEventsByUserId/:id', async (request, reply) => {
    const { id } = request.params;
    const user = await fetch('http://event.com/getUserById/' + id);
    const userData = await user.json();
    const userEvents = userData.events;

    // Fetch all events in parallel instead of sequentially
    const eventPromises = userEvents.map(eventId =>
        fetch('http://event.com/getEventById/' + eventId).then(resp => resp.json())
    );
    const eventArray = await Promise.all(eventPromises);

    reply.send(eventArray);
});

fastify.listen({ port: 3000 }, (err) => {
    listenMock();
    if (err) {
      fastify.log.error(err);
      process.exit();
    }
});
