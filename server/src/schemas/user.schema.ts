import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({ timestamps: true })
export class User extends Document {
  @Prop({ required: true, unique: true })
  openid: string; // 微信唯一标识
}

export const UserSchema = SchemaFactory.createForClass(User);
