//web3js imports 
import { Connection, PublicKey, VersionedTransaction } from '@solana/web3.js';

//jupiter api imports
import { createJupiterApiClient, QuoteResponse } from '@jup-ag/api';

import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';

import { Doughnut } from 'react-chartjs-2';
import 'chart.js/auto';

import tokenData from '../createcrate/tokens.json';

import BackendApi from '../../constants/api.ts'
import Sidebar from '../../components/ui/sidebar.tsx';
import SideBarPhone from '../../components/ui/sidebarPhone.tsx';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
import { Buffer } from 'buffer';


//recharts imports
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';




// Ensure the global Buffer is available
declare global {
  interface Window {
    Buffer: typeof Buffer;
  }
}

if (typeof window !== 'undefined') {
  window.Buffer = Buffer;
}

const getTokenMintAddress = (symbol: string): string => {
  const token = tokenData.find((t) => t.symbol.toUpperCase() === symbol.toUpperCase());
  if (token) {
    return token.address;
  }
  console.warn(`Token with symbol ${symbol} not found. Using Wrapped SOL address as fallback.`);
  return 'So11111111111111111111111111111111111111112';
};

interface Token {
  id: string;
  symbol: string;
  name: string;
  quantity: number;
  createdAt: string;
  crateId: string;
}

interface CrateData {
  id: string;
  name: string;
  image: string;
  createdAt: string;
  updatedAt: string;
  totalCost: number;
  creatorId: string;
  upvotes: number;
  downvotes: number;
  tokens: Token[];
}

type SwapQuote = {
  symbol: string;
  quote: QuoteResponse;
  transaction: VersionedTransaction;
  simulationLogs: string[] | null;
};


const calculateTokenAmount = (totalAmount: number, tokenQuantity: number, totalQuantity: number, inputDecimals = 6, outputDecimals = 6) => {
  const percentage = tokenQuantity / totalQuantity;
  const rawAmount = totalAmount * percentage;
  const scaleFactor = Math.pow(10, outputDecimals - inputDecimals);
  const adjustedAmount = rawAmount * scaleFactor;
  return Math.round(adjustedAmount);
};

const CrateDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const [crateData, setCrateData] = useState<CrateData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [inputAmount, setInputAmount] = useState<string>('');
  const [swapQuotes, setSwapQuotes] = useState<SwapQuote[]>([]);
  const [returnAmount, setReturnAmount] = useState<number>(479);
  const [investmentPeriod, setInvestmentPeriod] = useState<number>(1);


  // Retrieve wallet public key from localStorage (TipLink)
  const publicKeyFromLocalStorage = localStorage.getItem('tipLink_pk_connected');
  const userPublicKey = publicKeyFromLocalStorage ? new PublicKey(publicKeyFromLocalStorage) : null;

  const truncatePublicKey = (publicKey: string) => {
    return `${publicKey.slice(0, 4)}...${publicKey.slice(-4)}`;
  };


  useEffect(() => {
    const fetchCrateData = async () => {
      try {
        const response = await fetch(`${BackendApi}/crates/${id}`);
        if (!response.ok) {
          throw new Error('Failed to fetch crate data');
        }
        const data: CrateData = await response.json();
        setCrateData(data);
      } catch (err) {
        if (err instanceof Error) {
          setError(err.message);
        } else {
          setError('An unknown error occurred');
        }
      } finally {
        setLoading(false);
      }
    };

    fetchCrateData();
  }, [id]);

  
  const simulateAndExecuteSwap = async (inputMint: string, outputMint: string, amount: number, userPublicKey: PublicKey) => {
  
    const jupiterApi = await createJupiterApiClient();
  
    const connection = new Connection('https://mainnet.helius-rpc.com/?api-key=a95e3765-35c7-459e-808a-9135a21acdf6');
  
    const quoteResponse = await jupiterApi.quoteGet({
      inputMint,
      outputMint,
      amount,
      slippageBps: 50,
    });
  
    const swapResponse = await jupiterApi.swapPost({
      swapRequest: {
        quoteResponse,
        userPublicKey: userPublicKey.toString(),
        wrapAndUnwrapSol: true,
      }
    });
  
    const swapTransactionBuf = Buffer.from(swapResponse.swapTransaction, 'base64');
    const transaction = VersionedTransaction.deserialize(swapTransactionBuf);
  
    const latestBlockhash = await connection.getLatestBlockhash();
    transaction.message.recentBlockhash = latestBlockhash.blockhash;
  
    const simulation = await connection.simulateTransaction(transaction);
  
    if (simulation.value.err) {
      console.error('Simulation error:', simulation.value.logs);
      throw new Error('Transaction simulation failed');
    }
  
    return {
      transaction,
      simulationLogs: simulation.value.logs,
    };
  };


const getSwapQuotes = async (amount: number) => {
  if (!crateData || !amount) {
    console.error('Missing required data for swap quotes');
    return;
  }

  setLoading(true); // Add loading state
  setError(null); // Reset error state

  try {
    const jupiterApi = await createJupiterApiClient();
    const totalQuantity = crateData.tokens.reduce((sum, token) => sum + token.quantity, 0);

    const quotePromises = crateData.tokens.map(async (token) => {
      const tokenAmount = calculateTokenAmount(amount, token.quantity, totalQuantity);
      const mint = getTokenMintAddress(token.symbol);

      try {
        const quote = await jupiterApi.quoteGet({
          inputMint: USDC_MINT,
          outputMint: mint,
          amount: tokenAmount,
        });
        
        if (!userPublicKey) {
          throw new Error('Public key is missing');
        }

        const { transaction, simulationLogs } = await simulateAndExecuteSwap(
          USDC_MINT,
          mint,
          tokenAmount,
          userPublicKey
        );

        return { 
          symbol: token.symbol, 
          quote,
          transaction,
          simulationLogs
        };
      } catch (error) {
        console.error(`Error getting quote for token ${token.symbol}:`, error);
        return null;
      }
    });

    const results = await Promise.all(quotePromises);
    
    const filteredResults = results.filter((result): result is SwapQuote => result !== null);

    if (filteredResults.length === 0) {
      throw new Error('No valid quotes received');
    }

    setSwapQuotes(filteredResults);
  } catch (error) {
    console.error("Error fetching swap quotes:", error);
    setError(error instanceof Error ? error.message : 'An unknown error occurred');
  } finally {
    setLoading(false);
  }
};

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputAmount(e.target.value);
  };

  const handleGetQuotes = () => {
    getSwapQuotes(parseFloat(inputAmount));
  };

  const handleSwap = async (quote: SwapQuote) => {
    if (!userPublicKey) {
      console.error('Public key is missing');
      return;
    }

    try {
      const connection = new Connection('https://api.mainnet-beta.solana.com');
     
      const signedTransaction = await connection.sendRawTransaction(quote.transaction!.serialize());
     
      console.log('Transaction sent:', signedTransaction);
    } catch (error) {
      console.error('Failed to send transaction:', error);
    }
  };

  if (loading) return <div>Loading...</div>;
  if (error) return <div>Error: {error}</div>;
  if (!crateData) return <div>No crate data found</div>;


  const chartData = [
    { name: 'Jan', value: 4000 },
    { name: 'Feb', value: 3000 },
    { name: 'Mar', value: 5000 },
    { name: 'Apr', value: 4500 },
    { name: 'May', value: 6000 },
    { name: 'Jun', value: 5500 },
  ];

  const pieData = {
    labels: crateData.tokens.map(token => token.name),
    datasets: [
      {
        data: crateData.tokens.map(token => token.quantity),
        backgroundColor: crateData.tokens.map((_, index) => `hsl(${50 + index * 80 / crateData.tokens.length}, 70%, ${50 + index * 10 / crateData.tokens.length}%)`),
        borderColor: '#228B22', // Forest Green for borders
        borderWidth: 1,
      },
    ],
  };

  const pieOptions = {
    cutout: '50%', // Makes it a donut chart
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: false,
      },
    },
  };

  return (
    <div className="flex min-h-screen pl-24 bg-gradient-to-b from-[#0A1019] to-[#02050A] text-white">
      <Sidebar />
     
      <div className="flex-1 p-8">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold text-lime-400">{crateData.name}</h1>
          <div className="bg-gray-800 rounded-full px-4 py-2 text-sm">
            {userPublicKey ? truncatePublicKey(userPublicKey.toString()) : 'Wallet not connected'}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-8">
          <div className="col-span-2 bg-gray-800/10 rounded-xl p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-semibold">Performance</h2>
              <select className="bg-gray-700/10 rounded px-2 py-1">
                <option>All</option>
              </select>
            </div>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={chartData}>
                <XAxis dataKey="name" stroke="#6b7280" />
                <YAxis stroke="#6b7280" />
                <Tooltip />
                <Line type="monotone" dataKey="value" stroke="#84cc16" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
            <div className="flex justify-between mt-4 text-sm">
              <span>↑ {crateData.upvotes}</span>
              <span>↓ {crateData.downvotes}</span>
              <span>Created by: {crateData.creatorId}</span>
            </div>
          </div> 

          <div className="space-y-8">
            <div className="bg-gradient-to-b from-gray-800/10 to-green-800/10 rounded-xl p-6">
              <h2 className="text-xl font-semibold mb-4">Buy / Sell</h2>
              <div className="flex gap-4">
                <button className="flex-1  text-red-700 border-2 border-red-700 bg-transparent px-4 py-2 rounded-xl ">SELL</button>
                <button className="flex-1 bg-gradient-to-b from-lime-500 to-lime-700 text-black px-4 py-2 rounded-xl ">BUY</button>
              </div>
            </div>

            <div className="bg-gradient-to-b from-gray-800/10 to-green-800/10 rounded-xl p-6">
              
              <h2 className="text-xl mb-4 font-sans">Return_calculator</h2>
             
              <div className="flex items-center justify-between mb-4">
                <span className="text-2xl font-semibold text-lime-400">$169</span>
                <select className="bg-gray-700/10 rounded px-2 py-1">
                  <option>Monthly</option>
                </select>
              </div>
              <input
                type="range"
                min="1"
                max="36"
                value={investmentPeriod}
                onChange={(e) => setInvestmentPeriod(parseInt(e.target.value))}
                className="w-full appearance-none bg-gray-700 h-1 rounded-full outline-none"
                style={{
                  background: 'linear-gradient(to right, #84cc16 0%, #84cc16 ' + (investmentPeriod / 36 * 100) + '%, #4b5563 ' + (investmentPeriod / 36 * 100) + '%, #4b5563 100%)'
                }}
              />
              {/* @ts-ignore */}
              <style jsx>{`
                input[type=range]::-webkit-slider-thumb {
                  -webkit-appearance: none;
                  appearance: none;
                  width: 16px;
                  height: 16px;
                  border-radius: 50%;
                  background: black;
                  border: 2px solid #84cc16;
                  cursor: pointer;
                }
                input[type=range]::-moz-range-thumb {
                  width: 16px;
                  height: 16px;
                  border-radius: 50%;
                  background: black;
                  border: 2px solid #84cc16;
                  cursor: pointer;
                }
              `}</style>
              <div className="flex flex-col mt-4">
                <div className="flex justify-between gap-2 ">
                
                <span className="mb-2">Investment Period</span>
                  <div className="flex gap-3 ">
                
                  <button className=" hover:bg-lime-700/50 text-lime-100  p-1 bg-lime-700 rounded-xl  text-sm">6 months</button>
                 
                 <button className=" hover:bg-lime-700/50 text-lime-100  p-1 bg-lime-700 rounded-xl  text-sm">1 year</button>

                 <button className=" hover:bg-lime-700/50 text-lime-100  p-1 bg-lime-700 rounded-xl  text-sm">3 years</button>
                  </div>
                
                </div>
              </div>
              <div className="mt-4 pl-10">
                <span className="text-2xl ">Return: </span>
                <span className="text-2xl font-bold text-lime-400">${returnAmount}</span>
              </div>
            </div>
          </div>
        </div> 

        <div className="pr-[700px]">
        <div className="mt-8 bg-gradient-to-b from-lime-400/10 to-green-800/10 rounded-xl p-6">
          <h2 className="text-xl font-semibold mb-4 text-lime-400">token_Split</h2>
          <div className="flex">
            <div className="space-y-2 flex-1">
              {crateData.tokens.map((token, index) => (
                <div key={token.id}>
                  <div className="flex items-center">
                    <img src={`/path/to/${token.symbol}-icon.png`} alt={token.symbol} className="w-6 h-6 mr-2" />
                    <span className="text-lime-100 font-light">{token.name}</span>
                    <span className="ml-auto">{token.quantity}%</span>
                  </div>
                  {index < crateData.tokens.length - 1 && (
                    <hr className="my-2 border-lime-400/30" />
                  )}
                </div>
              ))}
            </div>
            <div style={{ width: '150px', height: '150px' }} className="ml-16">
              <Doughnut data={pieData} options={pieOptions} />
            </div>
          </div>
        </div>
        </div>
       
      </div>
      <SideBarPhone />
    </div>
  );
};

export default CrateDetailPage;
 
const TokenBar: React.FC<{ token: Token }> = ({ token }) => {
  const barWidth = `${token.quantity}%`;
  const hue = Math.floor(Math.random() * 360); // Generate a random hue for color variety

  return (
    <div className="mb-2">
      <div className="flex justify-between mb-1">
        <span className="text-sm font-medium">{token.name} ({token.symbol})</span>
        <span className="text-sm font-medium">{token.quantity}%</span>
      </div>
      <div className="w-full bg-gray-200 rounded-full h-2.5">
        <div 
          className="h-2.5 rounded-full" 
          style={{ width: barWidth, backgroundColor: `hsl(${hue}, 70%, 50%)` }}
        ></div>
      </div>
    </div>
  );
};