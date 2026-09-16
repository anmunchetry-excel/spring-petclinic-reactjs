const path = require('path');
const webpack = require('webpack');

const port = Number(process.env.PORT) || 3000;
const apiServerUrl = process.env.API_SERVER_URL || 'http://localhost:9966/petclinic';

module.exports = {
  mode: 'development',
  devtool: 'source-map',
  entry: './src/main.tsx',
  output: {
    path: path.join(__dirname, 'public/dist/'),
    filename: 'bundle.js',
    publicPath: '/dist/'
  },
  plugins: [
    new webpack.DefinePlugin({
      __API_SERVER_URL__: JSON.stringify(apiServerUrl)
    })
  ],
  resolve: {
    extensions: ['.ts', '.tsx', '.js']
  },
  module: {
    rules: [
      {
        test: /\.css$/,
        use: ['style-loader', 'css-loader']
      },
      {
        test: /\.less$/,
        use: ['style-loader', 'css-loader', 'less-loader']
      },
      {
        test: /\.(png|jpg|eot|svg|ttf|woff|woff2)$/,
        type: 'asset'
      },
      {
        test: /\.tsx?$/,
        include: path.join(__dirname, 'src'),
        use: {
          loader: 'ts-loader',
          options: { transpileOnly: true }
        }
      }
    ]
  },
  devServer: {
    port,
    hot: true,
    historyApiFallback: true,
    static: {
      directory: path.join(__dirname, 'public')
    },
    devMiddleware: {
      publicPath: '/dist/'
    }
  }
};
