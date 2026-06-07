class Analytics {
  constructor(config = {}) {
    this.config = {
      serverUrl: config.serverUrl || 'https://analytics.haoaiganfan.top/api/track',
      batchUrl: config.batchUrl || 'https://analytics.haoaiganfan.top/api/track/batch',
      batchSize: config.batchSize || 10,
      flushInterval: config.flushInterval || 5000,
      userId: config.userId || null,
      autoTrackPV: config.autoTrackPV !== false,
      autoTrackClick: config.autoTrackClick !== false,
      debug: config.debug || false
    };

    this.queue = [];
    this.sessionId = this.generateSessionId();
    this.isFlushPending = false;

    this.init();
  }

  init() {
    this.setUserId(this.config.userId || this.getUserId());
    this.setupAutoTrack();
    this.startFlushTimer();
    this.setupVisibilityListener();
    this.setupPageUnload();

    if (this.config.debug) {
      console.log('[Analytics] SDK 初始化成功', { userId: this.config.userId, sessionId: this.sessionId });
    }
  }

  generateSessionId() {
    return 'sess_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  }

  generateId() {
    return 'evt_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  }

  getUserId() {
    let userId = localStorage.getItem('analytics_user_id');
    if (!userId) {
      userId = 'user_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
      localStorage.setItem('analytics_user_id', userId);
    }
    return userId;
  }

  setUserId(userId) {
    this.config.userId = userId;
    if (userId) {
      localStorage.setItem('analytics_user_id', userId);
    }
  }

  resetUserId() {
    localStorage.removeItem('analytics_user_id');
    this.config.userId = this.getUserId();
  }

  setupAutoTrack() {
    if (this.config.autoTrackPV) {
      this.track('pv', {
        pageUrl: window.location.href,
        referrer: document.referrer,
        title: document.title
      });
    }

    if (this.config.autoTrackClick) {
      document.addEventListener('click', (e) => this.handleClick(e), true);
    }
  }

  handleClick(e) {
    const target = e.target;
    const selector = this.getSelector(target);

    this.track('click', {
      element: selector,
      text: target.textContent?.trim().slice(0, 50) || '',
      pageUrl: window.location.href,
      x: e.clientX,
      y: e.clientY
    });
  }

  getSelector(element) {
    if (element.id) return '#' + element.id;

    const classes = element.className;
    if (classes && typeof classes === 'string') {
      const classList = classes.trim().split(/\s+/);
      if (classList[0]) return '.' + classList[0];
    }

    const tag = element.tagName.toLowerCase();
    if (tag === 'a' && element.href) return 'a[href=' + element.pathname + ']';

    return tag;
  }

  setupVisibilityListener() {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        this.track('pv', {
          pageUrl: window.location.href,
          referrer: document.referrer,
          title: document.title
        });
      }
    });
  }

  setupPageUnload() {
    const sendOnUnload = () => {
      if (this.queue.length > 0) {
        navigator.sendBeacon(this.config.batchUrl, JSON.stringify(this.queue));
      }
    };

    window.addEventListener('beforeunload', sendOnUnload);
    window.addEventListener('pagehide', sendOnUnload);
  }

  startFlushTimer() {
    this.timer = setInterval(() => {
      this.flush();
    }, this.config.flushInterval);
  }

  track(eventType, properties = {}) {
    const event = {
      id: this.generateId(),
      eventType: eventType,
      userId: this.config.userId,
      sessionId: this.sessionId,
      pageUrl: properties.pageUrl || window.location.href,
      element: properties.element || null,
      eventTime: new Date().toISOString(),
      properties: properties
    };

    this.queue.push(event);

    if (this.config.debug) {
      console.log('[Analytics] 队列事件:', eventType, event);
    }

    if (this.queue.length >= this.config.batchSize) {
      this.flush();
    }
  }

  async flush() {
    if (this.isFlushPending || this.queue.length === 0) return;

    this.isFlushPending = true;
    const events = [...this.queue];
    this.queue = [];

    try {
      const response = await fetch(this.config.batchUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(events)
      });

      if (!response.ok) throw new Error('上报失败');

      if (this.config.debug) {
        console.log('[Analytics] 批量上报成功:', events.length);
      }
    } catch (error) {
      if (this.config.debug) {
        console.error('[Analytics] 上报失败，重新加入队列:', error);
      }
      this.queue.unshift(...events);
    } finally {
      this.isFlushPending = false;
    }
  }

  setPage(pageUrl) {
    this.track('pv', { pageUrl, title: document.title });
  }

  identify(userId) {
    this.setUserId(userId);
    this.track('identify', { userId });
  }

  destroy() {
    clearInterval(this.timer);
    this.flush();
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = Analytics;
} else if (typeof window !== 'undefined') {
  window.Analytics = Analytics;
}
