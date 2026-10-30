# kill process

```bash
lsof -tiTCP:2567 -sTCP:LISTEN | xargs kill
```

