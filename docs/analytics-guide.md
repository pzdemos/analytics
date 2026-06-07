# Analytics 埋点 SDK 使用指南

## 快速使用指南

### 1. 引入 SDK

```html
<!-- 压缩版 (推荐) -->
<script src="https://www.haoaiganfan.top/libs/analytics.min.js"></script>

<!-- 或完整版 -->
<script src="https://www.haoaiganfan.top/libs/analytics.js"></script>
```

### 2. 初始化

```html
<script>
  // 最简单 - 使用默认配置
  const analytics = new Analytics();
</script>
```

### 3. 使用方法

```javascript
// 自动追踪（SDK 默认开启）
// - PV（页面访问）自动上报
// - 点击事件自动捕获

// 自定义事件
analytics.track('custom', {
  action: 'add_to_cart',
  product_id: '12345',
  price: 99.9
});

// 设置用户ID
analytics.identify('user_abc123');

// 页面切换追踪
analytics.setPage('https://yoursite.com/product/123');

// 手动发送（用于页面离开前）
analytics.flush();
```

### 4. 配置选项（可选）

```javascript
const analytics = new Analytics({
  batchSize: 5,           // 批量发送数量（默认10）
  flushInterval: 3000,     // 发送间隔ms（默认5000）
  debug: true,             // 调试模式（默认false）
  autoTrackPV: true,       // 自动PV（默认true）
  autoTrackClick: true     // 自动点击（默认true）
});
```

### 5. 完整示例

```html
<!DOCTYPE html>
<html>
<head>
  <title>示例页面</title>
</head>
<body>
  <button id="buy-btn">购买</button>

  <script src="https://www.haoaiganfan.top/libs/analytics.min.js"></script>
  <script>
    // 初始化
    const analytics = new Analytics({
      debug: true
    });

    // 设置用户
    analytics.identify('user_12345');

    // 自定义事件
    document.getElementById('buy-btn').addEventListener('click', () => {
      analytics.track('purchase', {
        product_id: 'abc123',
        amount: 99.9
      });
    });
  </script>
</body>
</html>
```

### 6. 查看数据

```bash
# API 查询
curl "https://analytics.haoaiganfan.top/api/stats/pv?start=2026-06-01&end=2026-06-07"
curl "https://analytics.haoaiganfan.top/api/stats/path?userId=user_12345"
curl "https://analytics.haoaiganfan.top/api/stats/realtime?minutes=5"
```

## API 接口

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/track` | POST | 单条上报 |
| `/api/track/batch` | POST | 批量上报 |
| `/api/stats/pv` | GET | PV/UV 统计 |
| `/api/stats/path` | GET | 用户路径分析 |
| `/api/stats/funnel` | GET | 转化漏斗 |
| `/api/stats/realtime` | GET | 实时统计 |
| `/health` | GET | 健康检查 |

## 服务信息

- **API 地址：** https://analytics.haoaiganfan.top
- **SDK 地址：** https://www.haoaiganfan.top/libs/analytics.min.js
- **数据库：** MongoDB analytics
