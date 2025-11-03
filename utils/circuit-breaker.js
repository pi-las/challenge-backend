/**
 * Circuit Breaker Pattern Implementation
 *
 * States:
 * - CLOSED: Normal operation, requests pass through
 * - OPEN: Service is failing, reject requests immediately
 * - HALF_OPEN: Testing if service has recovered, allow limited requests
 */

const CIRCUIT_STATE = {
  CLOSED: 'CLOSED',
  OPEN: 'OPEN',
  HALF_OPEN: 'HALF_OPEN'
};

class CircuitBreaker {
  constructor(options = {}) {
    this.failureThreshold = options.failureThreshold || 3;
    this.failureWindowMs = options.failureWindowMs || 30000; // 30 seconds
    this.resetTimeoutMs = options.resetTimeoutMs || 10000; // 10 seconds initial timeout
    this.maxResetTimeoutMs = options.maxResetTimeoutMs || 60000; // Max 60 seconds

    this.state = CIRCUIT_STATE.CLOSED;
    this.failures = [];
    this.successCount = 0;
    this.openedAt = null;
    this.currentResetTimeout = this.resetTimeoutMs;
  }

  /**
   * Execute a function with circuit breaker protection
   */
  async execute(fn) {
    if (this.state === CIRCUIT_STATE.OPEN) {
      // Check if we should transition to HALF_OPEN
      if (Date.now() - this.openedAt >= this.currentResetTimeout) {
        this.state = CIRCUIT_STATE.HALF_OPEN;
        console.log('[CircuitBreaker] Transitioning to HALF_OPEN - testing service recovery');
      } else {
        // Circuit is still open, reject immediately
        const error = new Error('Circuit breaker is OPEN - service unavailable');
        error.circuitBreakerOpen = true;
        throw error;
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  /**
   * Handle successful request
   */
  onSuccess() {
    if (this.state === CIRCUIT_STATE.HALF_OPEN) {
      console.log('[CircuitBreaker] Service recovered - transitioning to CLOSED');
      this.reset();
    } else {
      // Remove old failures outside the window
      this.cleanupOldFailures();
    }
  }

  /**
   * Handle failed request
   */
  onFailure() {
    const now = Date.now();
    this.failures.push(now);

    // Clean up old failures outside the window
    this.cleanupOldFailures();

    const recentFailures = this.failures.length;
    console.log(`[CircuitBreaker] Failure recorded. Recent failures in window: ${recentFailures}`);

    if (this.state === CIRCUIT_STATE.HALF_OPEN) {
      // Failed during recovery test, go back to OPEN with exponential backoff
      this.openCircuit(true);
    } else if (recentFailures >= this.failureThreshold) {
      // Too many failures, open the circuit
      this.openCircuit(false);
    }
  }

  /**
   * Open the circuit breaker
   */
  openCircuit(isExponentialBackoff) {
    this.state = CIRCUIT_STATE.OPEN;
    this.openedAt = Date.now();

    if (isExponentialBackoff) {
      // Double the timeout on failed recovery, up to max
      this.currentResetTimeout = Math.min(
        this.currentResetTimeout * 2,
        this.maxResetTimeoutMs
      );
      console.log(`[CircuitBreaker] Recovery failed - OPEN with backoff timeout: ${this.currentResetTimeout}ms`);
    } else {
      console.log(`[CircuitBreaker] Failure threshold reached (${this.failureThreshold}) - OPEN for ${this.currentResetTimeout}ms`);
    }
  }

  /**
   * Reset circuit breaker to normal operation
   */
  reset() {
    this.state = CIRCUIT_STATE.CLOSED;
    this.failures = [];
    this.successCount = 0;
    this.openedAt = null;
    this.currentResetTimeout = this.resetTimeoutMs; // Reset to initial timeout
  }

  /**
   * Remove failures outside the time window
   */
  cleanupOldFailures() {
    const now = Date.now();
    const windowStart = now - this.failureWindowMs;
    this.failures = this.failures.filter(timestamp => timestamp > windowStart);
  }

  /**
   * Get current state information
   */
  getState() {
    return {
      state: this.state,
      failureCount: this.failures.length,
      openedAt: this.openedAt,
      nextRetryIn: this.openedAt
        ? Math.max(0, this.currentResetTimeout - (Date.now() - this.openedAt))
        : 0
    };
  }
}

module.exports = CircuitBreaker;
