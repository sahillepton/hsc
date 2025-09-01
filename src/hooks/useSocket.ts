import { useEffect, useRef, useState } from 'react';

interface SocketData {
  type: string;
  data: any;
}

export const useSocket = (url: string) => {
  const [isConnected, setIsConnected] = useState(false);
  const [data, setData] = useState<SocketData | null>(null);
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const socket = new WebSocket(url);
    socketRef.current = socket;

    socket.onopen = () => {
      console.log('WebSocket connected');
      setIsConnected(true);
    };

    socket.onmessage = (event) => {
      try {
        const parsedData = JSON.parse(event.data);
       // console.log(parsedData, "parsedData");
        setData(parsedData.nodes);
      } catch (error) {
        console.error('Error parsing WebSocket data:', error);
      }
    };

    socket.onclose = () => {
      console.log('WebSocket disconnected');
      setIsConnected(false);
    };

    socket.onerror = (error) => {
      console.error('WebSocket error:', error);
      setIsConnected(false);
    };

    return () => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.close();
      }
    };
  }, [url]);

  const sendMessage = (message: any) => {
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify(message));
    }
  };



  return {
    isConnected,
    data,
    sendMessage,
  };
};
