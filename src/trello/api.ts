import * as vscode from 'vscode';
import axios from 'axios';

export const trelloApiGetRequest = async (
  url: string,
  params: object
): Promise<any> => {
  try {
    const res = await axios.get(url, { params });
    return res.data;
  } catch (error: any) {
    if (error.response) {
      console.error('GET error', error.response);
      vscode.window.showErrorMessage(
        `HTTP error: ${error.response.status} - ${error.response.data}`
      );
    }
  }
  return null;
};

export const trelloApiPostRequest = async (
  url: string,
  data: object
): Promise<any> => {
  try {
    const res = await axios.post(url, data);
    return res.data;
  } catch (error: any) {
    if (error.response) {
      console.error('POST error', error.response);
      vscode.window.showErrorMessage(
        `HTTP error: ${error.response.status} - ${error.response.data}`
      );
    }
  }
  return null;
};
