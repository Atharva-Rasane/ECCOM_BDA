import { DataTypes, Model, type ModelStatic } from 'sequelize';
import { type CouponAttributes } from '../types/models/couponTypes';

export class Coupon
    extends Model<CouponAttributes>
    implements CouponAttributes
{
    id: number;
    maxUsage: number;
    amount: number;
    usage: number;
    code: string;
}

export function couponFactory(sequelize): ModelStatic<Coupon> {
    return Coupon.init(
        {
            id: {
                type: DataTypes.INTEGER,
                autoIncrement: true,
                primaryKey: true,
            },
            maxUsage: {
                type: DataTypes.INTEGER,
                defaultValue: 5,
            },
            amount: {
                type: DataTypes.FLOAT(4),
                allowNull: false,
            },
            usage: {
                type: DataTypes.INTEGER,
                allowNull: false,
                defaultValue: 0,
            },
            code: {
                type: DataTypes.STRING,
                allowNull: false,
            },
        },
        { sequelize }
    );
}
